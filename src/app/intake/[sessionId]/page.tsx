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
import type { AgentEvent, TranscriptEvent } from "@/types";

// Screen 2 (patient voice intake). The patient speaks, Deepgram transcribes,
// and each finished utterance drives one turn of the deterministic agent loop.
// The typed box below stays: it is the manual rung of the fallback ladder if
// the mic or Deepgram fails on stage, and it is how the loop gets exercised
// without a microphone.
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

  const runTurn = useCallback(
    async (text: string) => {
      const utterance = text.trim();
      if (!utterance) return;

      setTurnError(null);
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
      setTurnPhase("thinking");

      try {
        const response = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: params.sessionId, utterance }),
        });
        if (!response.ok) throw new Error(`The agent turn failed (${response.status})`);

        const result = (await response.json()) as {
          reply: string;
          nextState: string;
          toolEvents?: AgentEvent[];
        };

        setTranscript((prev) => [
          ...prev,
          {
            id: prev.length,
            sessionId: params.sessionId,
            speaker: "agent",
            text: result.reply,
            isFinal: true,
            sequenceNo: prev.length,
            createdAt: new Date().toISOString(),
          },
        ]);
        setAgentEvents((prev) => [...prev, ...(result.toolEvents ?? [])]);
        setNextState(result.nextState);

        setTurnPhase("speaking");
        // Resolves when playback ends, or immediately if voice is not running —
        // the reply is already on screen either way.
        await voiceRef.current?.speak(result.reply);

        if (result.nextState === "CLINICIAN_REVIEW_READY") {
          voiceRef.current?.stop();
          setVoiceActive(false);
          router.push(`/clinician/${params.sessionId}`);
        }
      } catch (error) {
        setTurnError(error instanceof Error ? error.message : "The agent turn failed");
      } finally {
        setTurnPhase("idle");
      }
    },
    [params.sessionId, router]
  );

  // Utterances queue rather than run immediately: the patient can finish a
  // second sentence while the first turn is still in flight, and turns must
  // stay ordered because the state machine advances one step per turn.
  const queueRef = useRef<string[]>([]);
  const drainingRef = useRef(false);

  const enqueueUtterance = useCallback(
    (text: string) => {
      queueRef.current.push(text);
      if (drainingRef.current) return;

      drainingRef.current = true;
      void (async () => {
        try {
          while (queueRef.current.length > 0) {
            await runTurn(queueRef.current.shift()!);
          }
        } finally {
          drainingRef.current = false;
        }
      })();
    },
    [runTurn]
  );

  const voice = useVoiceSession(enqueueUtterance);
  useEffect(() => {
    voiceRef.current = voice;
  });

  async function startVoice() {
    setVoiceActive(await voice.start());
  }

  function endVoice() {
    voice.stop();
    setVoiceActive(false);
  }

  function submitTyped() {
    if (!typed.trim() || turnPhase !== "idle") return;
    enqueueUtterance(typed);
    setTyped("");
  }

  const orbState: VoiceOrbState =
    turnPhase === "speaking"
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
          {voiceActive ? (
            <Button variant="outline" onClick={endVoice}>
              End voice session
            </Button>
          ) : (
            <Button onClick={startVoice} disabled={voice.phase === "starting"}>
              {voice.phase === "starting" ? "Starting…" : "Start voice intake"}
            </Button>
          )}

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
        </div>

        {voice.error && (
          <p className="text-center text-sm text-red-600">
            {voice.error}. You can continue by typing below.
          </p>
        )}
        {turnError && <p className="text-center text-sm text-red-600">{turnError}</p>}

        <LiveTranscript events={transcript} interim={voice.interim} />

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
              voiceActive ? "Or type what the patient says…" : "Type what the patient says…"
            }
            className="min-h-0"
          />
          <Button onClick={submitTyped} disabled={turnPhase !== "idle" || !typed.trim()}>
            Send
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Synthetic demo only. Clinician review required. Current state: {nextState}
        </p>
      </div>

      <AgentActivity events={agentEvents} pending={turnPhase === "thinking"} />
    </main>
  );
}
