import { cn } from "@/lib/utils";
import type { TranscriptEvent } from "@/types";

/**
 * `interim` is the patient's current, not-yet-final utterance from the live
 * stream. It renders as a dimmed bubble in the patient's own column so the
 * words appear while they are still speaking, then is replaced by the
 * committed event when the turn ends.
 */
export function LiveTranscript({
  events,
  interim = "",
}: {
  events: TranscriptEvent[];
  interim?: string;
}) {
  return (
    <div className="flex flex-col gap-3 overflow-y-auto">
      {events.length === 0 && !interim && (
        // An unframed empty region reads as something failing to load. Saying
        // what will appear here is calmer than a blank half-screen.
        <p className="py-8 text-center text-base text-muted-foreground">
          The conversation will appear here as the patient speaks.
        </p>
      )}
      {events.map((event, index) => (
        // Keyed by position, for the same reason as the activity rail: this is
        // an append-only log that never reorders, and `event.id` is not unique
        // across sources. The live path numbers events by their position in the
        // array while replayed events carry database ids, so after a replay is
        // stopped and the operator types a turn, the two collide.
        <div
          key={index}
          className={cn(
            // text-base/lg, not text-sm: this is the one region a judge reads
            // from several feet away while the demo runs.
            "max-w-[80%] rounded-2xl px-5 py-3 text-base leading-relaxed md:text-lg",
            event.speaker === "agent"
              ? "self-start bg-white text-slate-900 ring-1 ring-slate-900/10"
              : "self-end bg-primary text-primary-foreground"
          )}
        >
          {event.text}
        </div>
      ))}
      {interim && (
        <div className="max-w-[80%] self-end rounded-2xl bg-primary/50 px-5 py-3 text-base leading-relaxed text-primary-foreground md:text-lg">
          {interim}
        </div>
      )}
    </div>
  );
}
