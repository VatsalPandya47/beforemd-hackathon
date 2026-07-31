import { cn } from "@/lib/utils";
import type { TranscriptEvent } from "@/types";

export function LiveTranscript({ events }: { events: TranscriptEvent[] }) {
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
    </div>
  );
}
