"use client";

import { cn } from "@/lib/utils";

export type VoiceOrbState = "idle" | "listening" | "thinking" | "speaking";

const STATE_LABEL: Record<VoiceOrbState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

/**
 * `level` is the live mic level (0..1). While listening the orb breathes with
 * the patient's voice rather than on a fixed timer — the difference between
 * the demo reading as connected to the audio and reading as decorative.
 */
export function VoiceOrb({ state, level = 0 }: { state: VoiceOrbState; level?: number }) {
  const listening = state === "listening";
  const scale = listening
    ? 1 + Math.min(level, 1) * 0.18
    : state === "speaking"
      ? 1.1
      : state === "thinking"
        ? 0.95
        : 1;

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={cn(
          "size-40 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg",
          // Quick enough to track speech while listening, calm otherwise.
          listening ? "transition-transform duration-100" : "transition-transform duration-500",
          state === "thinking" && "animate-pulse opacity-80"
        )}
        style={{ transform: `scale(${scale.toFixed(3)})` }}
        aria-hidden
      />
      <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
        {STATE_LABEL[state]}
      </p>
    </div>
  );
}
