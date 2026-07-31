"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VoiceOrb, type VoiceOrbState } from "@/components/voice-orb";
import { LiveTranscript } from "@/components/live-transcript";
import { AgentActivity } from "@/components/agent-activity";
import type { AgentEvent, TranscriptEvent } from "@/types";

// Screen 2 (patient voice intake). Deepgram mic streaming plugs in here —
// this page currently accepts typed utterances so the agent turn loop can be
// exercised end-to-end before the live voice path is wired (doc P1 tickets).
export default function IntakePage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [orbState, setOrbState] = useState<VoiceOrbState>("idle");
  const [utterance, setUtterance] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [nextState, setNextState] = useState("CONSENT");

  async function sendTurn() {
    if (!utterance.trim()) return;
    setOrbState("thinking");

    const patientEvent: TranscriptEvent = {
      id: transcript.length,
      sessionId: params.sessionId,
      speaker: "patient",
      text: utterance,
      isFinal: true,
      sequenceNo: transcript.length,
      createdAt: new Date().toISOString(),
    };
    setTranscript((prev) => [...prev, patientEvent]);
    setUtterance("");

    const response = await fetch("/api/agent/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: params.sessionId, utterance: patientEvent.text }),
    });
    const result = await response.json();

    setOrbState("speaking");
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
    setOrbState("idle");

    if (result.nextState === "CLINICIAN_REVIEW_READY") {
      router.push(`/clinician/${params.sessionId}`);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl grid-cols-1 gap-8 p-8 md:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-6">
        <VoiceOrb state={orbState} />
        <LiveTranscript events={transcript} />
        <div className="flex gap-2">
          <Textarea
            value={utterance}
            onChange={(event) => setUtterance(event.target.value)}
            placeholder="Type what the patient says..."
            className="min-h-0"
          />
          <Button onClick={sendTurn}>Send</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Synthetic demo only. Clinician review required. Current state: {nextState}
        </p>
      </div>
      <AgentActivity events={agentEvents} />
    </main>
  );
}
