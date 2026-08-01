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
      {events.map((event) => (
        <div
          key={event.id}
          className={cn(
            "max-w-[80%] rounded-2xl px-4 py-2 text-sm",
            event.speaker === "agent"
              ? "self-start bg-slate-100 text-slate-900"
              : "self-end bg-blue-600 text-white"
          )}
        >
          {event.text}
        </div>
      ))}
      {interim && (
        <div className="max-w-[80%] self-end rounded-2xl bg-blue-600/50 px-4 py-2 text-sm text-white">
          {interim}
        </div>
      )}
    </div>
  );
}
