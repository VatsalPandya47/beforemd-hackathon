"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { VoiceOrb, type VoiceOrbState } from "@/components/voice-orb";
import { LiveTranscript } from "@/components/live-transcript";
import { AgentActivity } from "@/components/agent-activity";
import { useVoiceSession, type UseVoiceSession } from "@/lib/voice/use-voice-session";
import { useReplaySession, type ReplayFrame } from "@/lib/replay/use-replay-session";
import type { AgentEvent, TranscriptEvent } from "@/types";

// "opening" is the agent speaking first; every other turn answers a patient
// utterance. Both run the same agent loop, so they share one path here.
type TurnKind = "utterance" | "opening";
type QueuedTurn = { text: string; kind: TurnKind };

// Screen 2 (patient voice intake). The patient speaks, Deepgram transcribes,
// and each finished utterance drives one turn of the deterministic agent loop.
// The one turn no patient utterance drives is the opening: the agent greets and
// asks for consent as soon as the mic is live, so nobody has to guess that the
// silent orb is waiting on them.
//
// Two rungs of the fallback ladder live on this screen alongside the live path:
// the typed box (manual, and the only way to exercise the loop without a mic)
// and replay (issue #18), which re-streams a committed conversation into the
// same transcript and rail. Replay is the rung to reach for when the mic or
// Deepgram fails outright rather than degrading.
export default function IntakePage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [nextState, setNextState] = useState("CONSENT");
  const [turnPhase, setTurnPhase] = useState<"idle" | "thinking" | "speaking">("idle");
  const [turnError, setTurnError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [voiceActive, setVoiceActive] = useState(false);

  // The voice session is created below but used inside runTurn, so it is
  // reached through a ref rather than closed over.
  const voiceRef = useRef<UseVoiceSession | null>(null);

  // Bumped whenever the live conversation is abandoned — today only by replay
  // taking over. A turn captures the epoch it started in and drops its results
  // if that no longer matches, because `await` means a turn can outlive the
  // conversation it belongs to: without this, a reply that was in flight when
  // replay started lands in the middle of the replayed transcript, and a turn
  // that resolves to CLINICIAN_REVIEW_READY navigates away mid-replay.
  const turnEpochRef = useRef(0);
  const turnAbortRef = useRef<AbortController | null>(null);

  const runTurn = useCallback(
    async (text: string, kind: TurnKind) => {
      const utterance = text.trim();
      if (kind === "utterance" && !utterance) return;

      const epoch = turnEpochRef.current;
      const stale = () => turnEpochRef.current !== epoch;

      const controller = new AbortController();
      turnAbortRef.current = controller;

      setTurnError(null);
      if (kind === "utterance") {
        setTranscript((prev) => [
          ...prev,
          {
            id: prev.length,
            sessionId: params.sessionId,
            speaker: "patient",
            text: utterance,
            isFinal: true,
            sequenceNo: prev.length,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      setTurnPhase("thinking");

      try {
        const response = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            kind === "opening"
              ? { sessionId: params.sessionId, kind }
              : { sessionId: params.sessionId, kind, utterance }
          ),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`The agent turn failed (${response.status})`);

        const result = (await response.json()) as {
          // Null only when the server declines an opening turn because the
          // conversation is already under way.
          reply: string | null;
          nextState: string;
          toolEvents?: AgentEvent[];
        };

        // The turn is still committed server-side — only this screen stops
        // caring, because replay now owns what is on it.
        if (stale()) return;

        const reply = result.reply;
        if (reply) {
          setTranscript((prev) => [
            ...prev,
            {
              id: prev.length,
              sessionId: params.sessionId,
              speaker: "agent",
              text: reply,
              isFinal: true,
              sequenceNo: prev.length,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
        setAgentEvents((prev) => [...prev, ...(result.toolEvents ?? [])]);
        setNextState(result.nextState);

        if (reply) {
          setTurnPhase("speaking");
          // Resolves when playback ends, or immediately if voice is not
          // running — the reply is already on screen either way. The engine
          // mutes the mic while it plays, so the agent never hears itself.
          await voiceRef.current?.speak(reply);
        }

        if (stale()) return;

        if (result.nextState === "CLINICIAN_REVIEW_READY") {
          voiceRef.current?.stop();
          setVoiceActive(false);
          router.push(`/clinician/${params.sessionId}`);
        }
      } catch (error) {
        // An abort is this screen abandoning the turn, not a failure to report.
        if (stale() || controller.signal.aborted) return;
        setTurnError(error instanceof Error ? error.message : "The agent turn failed");
      } finally {
        if (!stale()) setTurnPhase("idle");
        if (turnAbortRef.current === controller) turnAbortRef.current = null;
      }
    },
    [params.sessionId, router]
  );

  // Turns queue rather than run immediately: the patient can finish a second
  // sentence while the first turn is still in flight, and turns must stay
  // ordered because the state machine advances one step per turn. The opening
  // turn goes through the same queue for exactly that reason — a patient who
  // starts talking the instant the mic opens must not overtake the greeting.
  const queueRef = useRef<QueuedTurn[]>([]);
  const drainingRef = useRef(false);

  const enqueueTurn = useCallback(
    (turn: QueuedTurn) => {
      queueRef.current.push(turn);
      if (drainingRef.current) return;

      drainingRef.current = true;
      void (async () => {
        try {
          while (queueRef.current.length > 0) {
            const next = queueRef.current.shift()!;
            await runTurn(next.text, next.kind);
          }
        } finally {
          drainingRef.current = false;
        }
      })();
    },
    [runTurn]
  );

  const enqueueUtterance = useCallback(
    (text: string) => enqueueTurn({ text, kind: "utterance" }),
    [enqueueTurn]
  );

  const voice = useVoiceSession(enqueueUtterance);
  useEffect(() => {
    voiceRef.current = voice;
  });

  // Replay writes into the same two pieces of state the live path writes, so
  // nothing downstream — transcript, rail, orb — knows which one produced a
  // given event. `replayOrbState` is the one exception: a replayed run has no
  // mic level or turn phase to drive the orb, so it is inferred from the frames.
  // It only feeds the orb while replay is active, so it needs no reset when
  // replay ends — the live branch takes over and reads idle.
  const [replayOrbState, setReplayOrbState] = useState<VoiceOrbState>("idle");

  const handleReplayBegin = useCallback(() => {
    // Replay is reached for when the live path is already misbehaving, so it
    // takes the screen rather than waiting its turn: retire any in-flight turn,
    // drop utterances still queued behind it, and abort the request so it is
    // not left running. Deliberately not gated on `turnPhase === "idle"` — a
    // hung agent turn is the likeliest reason anyone presses this button, so
    // that gate would disable replay exactly when it is needed.
    turnEpochRef.current += 1;
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    queueRef.current = [];

    voiceRef.current?.stop();
    setVoiceActive(false);
    setTranscript([]);
    setAgentEvents([]);
    setTurnError(null);
    setTurnPhase("idle");
    setNextState("CONSENT");
    setReplayOrbState("idle");
  }, []);

  const handleReplayFrame = useCallback((frame: ReplayFrame) => {
    if (frame.type === "transcript") {
      setTranscript((prev) => [...prev, frame.event]);
      setReplayOrbState(frame.event.speaker === "agent" ? "speaking" : "listening");
    } else {
      setAgentEvents((prev) => [...prev, frame.event]);
      setReplayOrbState("thinking");
    }
  }, []);

  const replay = useReplaySession({
    sessionId: params.sessionId,
    onBegin: handleReplayBegin,
    onFrame: handleReplayFrame,
  });

  async function startVoice() {
    const started = await voice.start();
    setVoiceActive(started);
    // The patient should never have to speak first into silence. The server
    // ignores this on any session past CONSENT, so restarting the mic
    // mid-conversation picks up where it left off instead of re-greeting.
    if (started) enqueueTurn({ text: "", kind: "opening" });
  }

  function endVoice() {
    voice.stop();
    setVoiceActive(false);
  }

  function submitTyped() {
    if (!typed.trim() || turnPhase !== "idle" || replay.active) return;
    enqueueUtterance(typed);
    setTyped("");
  }

  // A replayed run drives the orb off its own frames; a live one off the mic
  // and the turn phase.
  const orbState: VoiceOrbState = replay.active
    ? replayOrbState
    : turnPhase === "speaking"
      ? "speaking"
      : turnPhase === "thinking" || voice.phase === "processing"
        ? "thinking"
        : voice.phase === "listening"
          ? "listening"
          : "idle";

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl grid-cols-1 gap-8 p-8 md:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-6">
        <VoiceOrb state={orbState} level={voice.level} />

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            {voiceActive ? (
              <Button variant="outline" onClick={endVoice}>
                End voice session
              </Button>
            ) : (
              <Button
                onClick={startVoice}
                disabled={voice.phase === "starting" || replay.active}
              >
                {voice.phase === "starting" ? "Starting…" : "Start voice intake"}
              </Button>
            )}

            {/* The replay rung. Always reachable rather than only appearing
                after a failure: on stage the operator needs it to be one
                predictable click, not a control that shows up under stress. */}
            {replay.active ? (
              <Button variant="outline" onClick={replay.stop}>
                Stop replay
              </Button>
            ) : (
              <Button variant="outline" onClick={replay.start}>
                {replay.phase === "done" ? "Replay again" : "Replay demo"}
              </Button>
            )}
          </div>

          {voiceActive && voice.mode && (
            // Provenance, not decoration: which Deepgram path this session is
            // actually running on.
            <Badge
              className="bg-blue-100 text-blue-700"
              variant="secondary"
              title={voice.modeReason}
            >
              {voice.mode === "stream" ? "Deepgram live stream" : "Deepgram · server transcription"}
            </Badge>
          )}

          {replay.source && (
            // Same provenance rule as every adapter: say which source produced
            // what is on screen, never hide a fixture behind live-looking UI.
            <Badge className="bg-slate-100 text-slate-700" variant="secondary">
              {replay.source === "live"
                ? "Replay · recorded session"
                : "Replay · scripted demo fixture"}
            </Badge>
          )}
        </div>

        {voice.error && (
          <p className="text-center text-sm text-red-600">
            {voice.error}. You can continue by typing below, or run the recorded demo with
            Replay demo.
          </p>
        )}
        {replay.error && <p className="text-center text-sm text-red-600">{replay.error}</p>}
        {turnError && <p className="text-center text-sm text-red-600">{turnError}</p>}

        <LiveTranscript events={transcript} interim={voice.interim} />

        {/* Replay drives the state machine from committed events rather than
            through it, so it never reaches CLINICIAN_REVIEW_READY and never
            navigates on its own. The handoff is explicit instead — on stage the
            operator decides when to move to the clinician screen.

            This was previously withheld after replaying a recorded session,
            because the clinician screen showed `demoClinicalDraft` for every
            session and the brief would not have matched the conversation. That
            was a workaround for #30; now that the screen loads the draft
            belonging to its own session id and labels where it came from, the
            handoff is truthful from either replay source. */}
        {replay.phase === "done" && (
          <Button
            className="self-center"
            onClick={() => router.push(`/clinician/${params.sessionId}`)}
          >
            Continue to clinician review
          </Button>
        )}

        <div className="flex gap-2">
          <Textarea
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitTyped();
              }
            }}
            placeholder={
              replay.active
                ? "Replaying the recorded session…"
                : voiceActive
                  ? "Or type what the patient says…"
                  : "Type what the patient says…"
            }
            disabled={replay.active}
            className="min-h-0"
          />
          <Button
            onClick={submitTyped}
            disabled={turnPhase !== "idle" || !typed.trim() || replay.active}
          >
            Send
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Synthetic demo only. Clinician review required.{" "}
          {replay.active ? "Replaying a recorded session." : `Current state: ${nextState}`}
        </p>
      </div>

      <AgentActivity events={agentEvents} pending={turnPhase === "thinking"} />
    </main>
  );
}
