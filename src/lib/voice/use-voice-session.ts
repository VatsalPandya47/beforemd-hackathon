"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceSession, type VoiceMode, type VoicePhase } from "@/lib/voice/voice-session";

// Thin React wrapper over VoiceSession. All the audio logic lives in the
// engine; this only mirrors its state into render state and keeps one instance
// alive for the life of the page.

export type UseVoiceSession = {
  phase: VoicePhase;
  mode: VoiceMode | null;
  /** Why we are on this mode — shown as provenance, per the sponsor-visibility bar. */
  modeReason: string;
  /** Words heard so far in the current turn. Stream mode only. */
  interim: string;
  /** Mic level 0..1, for the orb. */
  level: number;
  error: string | null;
  start: () => Promise<boolean>;
  stop: () => void;
  speak: (text: string) => Promise<void>;
};

export function useVoiceSession(onUtterance: (text: string) => void): UseVoiceSession {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [mode, setMode] = useState<VoiceMode | null>(null);
  const [modeReason, setModeReason] = useState("");
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so a re-render never rebuilds the audio pipeline.
  const sessionRef = useRef<VoiceSession | null>(null);
  const onUtteranceRef = useRef(onUtterance);

  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  }, [onUtterance]);

  const getSession = useCallback(() => {
    if (!sessionRef.current) {
      sessionRef.current = new VoiceSession({
        onPhase: setPhase,
        onInterim: setInterim,
        onUtterance: (text) => onUtteranceRef.current(text),
        onLevel: (next) =>
          // Arrives ~15x/second; quantising keeps this from re-rendering the
          // page on every audio chunk.
          setLevel((current) => (Math.abs(next - current) > 0.05 ? next : current)),
        onMode: (nextMode, reason) => {
          setMode(nextMode);
          setModeReason(reason);
        },
        onError: setError,
      });
    }
    return sessionRef.current;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const result = await getSession().start();
    return result.ok;
  }, [getSession]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    setInterim("");
    setLevel(0);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      await sessionRef.current?.speak(text);
    },
    []
  );

  // Releases the mic if the patient navigates away mid-session.
  useEffect(() => () => sessionRef.current?.stop(), []);

  return { phase, mode, modeReason, interim, level, error, start, stop, speak };
}
