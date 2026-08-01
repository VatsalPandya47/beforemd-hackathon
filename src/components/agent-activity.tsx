import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AgentEvent } from "@/types";

const EVENT_TONE: Record<AgentEvent["eventType"], string> = {
  tool_started: "bg-slate-100 text-slate-700",
  tool_completed: "bg-emerald-100 text-emerald-700",
  insight: "bg-blue-100 text-blue-700",
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
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-500">Agent activity</h3>
      <Separator />
      {events.length === 0 && !pending && (
        <p className="text-sm text-muted-foreground">No tool activity yet.</p>
      )}
      {events.map((event, index) => (
        // Keyed by position: this is an append-only log that never reorders,
        // and event.id is not unique until the event has been persisted.
        <div key={index} className="flex items-center gap-2 text-sm">
          <Badge className={EVENT_TONE[event.eventType]} variant="secondary">
            {event.toolName ?? event.eventType}
          </Badge>
          <span className="text-slate-700">{event.title}</span>
        </div>
      ))}
      {pending && (
        <div className="flex items-center gap-2 text-sm">
          <Badge className="animate-pulse bg-slate-100 text-slate-700" variant="secondary">
            working
          </Badge>
          <span className="text-slate-500">Reviewing that answer…</span>
        </div>
      )}
    </div>
  );
}
