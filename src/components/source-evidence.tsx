import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SourceEvidence({
  sourceType,
  sourceId,
  label,
}: {
  sourceType: string;
  sourceId: string;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger className="rounded-full border border-border bg-white px-3 py-1 text-sm font-medium text-slate-600 hover:border-ring hover:text-primary">
        {label}
      </TooltipTrigger>
      <TooltipContent>
        {sourceType} · {sourceId}
      </TooltipContent>
    </Tooltip>
  );
}
