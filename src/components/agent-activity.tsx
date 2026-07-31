import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AgentEvent } from "@/types";

const EVENT_TONE: Record<AgentEvent["eventType"], string> = {
  tool_started: "bg-slate-100 text-slate-700",
  tool_completed: "bg-emerald-100 text-emerald-700",
  insight: "bg-blue-100 text-blue-700",
  safety_flag: "bg-red-100 text-red-700",
};

export function AgentActivity({ events }: { events: AgentEvent[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-500">Agent activity</h3>
      <Separator />
      {events.length === 0 && (
        <p className="text-sm text-muted-foreground">No tool activity yet.</p>
      )}
      {events.map((event) => (
        <div key={event.id} className="flex items-center gap-2 text-sm">
          <Badge className={EVENT_TONE[event.eventType]} variant="secondary">
            {event.toolName ?? event.eventType}
          </Badge>
          <span className="text-slate-700">{event.title}</span>
        </div>
      ))}
    </div>
  );
}
