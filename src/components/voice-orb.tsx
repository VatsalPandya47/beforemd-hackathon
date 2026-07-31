"use client";

import { cn } from "@/lib/utils";

export type VoiceOrbState = "idle" | "listening" | "thinking" | "speaking";

const STATE_LABEL: Record<VoiceOrbState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

export function VoiceOrb({ state }: { state: VoiceOrbState }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={cn(
          "size-40 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg transition-transform duration-500",
          state === "listening" && "scale-105 animate-pulse",
          state === "thinking" && "scale-95 opacity-80",
          state === "speaking" && "scale-110"
        )}
        aria-hidden
      />
      <p className="text-sm font-medium text-muted-foreground">{STATE_LABEL[state]}</p>
    </div>
  );
}
