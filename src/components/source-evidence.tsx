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
      <TooltipTrigger className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-blue-400 hover:text-blue-700">
        {label}
      </TooltipTrigger>
      <TooltipContent>
        {sourceType} · {sourceId}
      </TooltipContent>
    </Tooltip>
  );
}
