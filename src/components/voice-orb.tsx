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
    <div className="flex flex-col items-center gap-5">
      {/* The halo is a static ring rather than a second animation: it gives the
          orb depth on a projector without adding motion beyond the voice state
          itself, which is one of the three sanctioned ones (doc section 8). */}
      <div className="relative flex size-52 items-center justify-center">
        <div
          aria-hidden
          className="absolute inset-0 rounded-full bg-blue-500/10 ring-1 ring-blue-500/15"
        />
        <div
          className={cn(
            // Navy into blue, matching --primary, so the orb belongs to the
            // palette instead of being the one saturated object on screen.
            "size-40 rounded-full bg-gradient-to-br from-blue-600 to-blue-900",
            "shadow-[0_18px_40px_-18px_oklch(0.379_0.146_265.522/0.6)]",
            // Quick enough to track speech while listening, calm otherwise.
            listening ? "transition-transform duration-100" : "transition-transform duration-500",
            state === "thinking" && "animate-pulse opacity-80"
          )}
          style={{ transform: `scale(${scale.toFixed(3)})` }}
          aria-hidden
        />
      </div>
      <p
        className="text-base font-medium tracking-wide text-slate-600 uppercase"
        aria-live="polite"
      >
        {STATE_LABEL[state]}
      </p>
    </div>
  );
}
