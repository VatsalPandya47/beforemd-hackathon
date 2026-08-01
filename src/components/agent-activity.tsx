import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AgentEvent } from "@/types";

// Completed is the only green on this rail (doc section 8 keeps green for
// completed steps); started is neutral, insight is the palette's blue, and a
// safety flag is the one thing allowed to shout.
const EVENT_TONE: Record<AgentEvent["eventType"], string> = {
  tool_started: "bg-slate-100 text-slate-700",
  tool_completed: "bg-success-muted text-success-muted-foreground",
  insight: "bg-accent text-accent-foreground",
  safety_flag: "bg-red-100 text-red-700",
};

/**
 * `pending` covers the gap between the patient finishing a sentence and that
 * turn's tool events arriving, so this rail is never blank while the agent is
 * working (go/no-go: nothing waits more than two seconds without progress UI).
 */
export function AgentActivity({
  events,
  pending = false,
}: {
  events: AgentEvent[];
  pending?: boolean;
}) {
  return (
    // Framed as a panel rather than floating text: the rail is a column of its
    // own on this screen, and an unbounded list beside the transcript read like
    // leftover markup.
    <div className="flex h-fit flex-col gap-4 rounded-xl bg-white/70 p-5 ring-1 ring-slate-900/5">
      <h3 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
        Agent activity
      </h3>
      <Separator />
      {events.length === 0 && !pending && (
        <p className="text-base text-muted-foreground">No tool activity yet.</p>
      )}
      {events.map((event, index) => (
        // Keyed by position: this is an append-only log that never reorders,
        // and event.id is not unique until the event has been persisted.
        // Badge above the title rather than beside it: with wrapping, a short
        // title sat next to its badge while a long one dropped below, so the
        // rail read ragged as it filled up.
        <div key={index} className="flex flex-col items-start gap-1 text-base">
          <Badge className={EVENT_TONE[event.eventType]} variant="secondary">
            {event.toolName ?? event.eventType}
          </Badge>
          <span className="text-slate-700">{event.title}</span>
        </div>
      ))}
      {pending && (
        <div className="flex flex-col items-start gap-1 text-base">
          <Badge className="animate-pulse bg-slate-100 text-slate-700" variant="secondary">
            working
          </Badge>
          <span className="text-slate-500">Reviewing that answer…</span>
        </div>
      )}
    </div>
  );
}
