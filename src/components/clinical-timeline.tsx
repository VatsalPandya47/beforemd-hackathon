import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SourceEvidence } from "@/components/source-evidence";
import type { KeyConnection, TimelineEntry } from "@/types";

export function ClinicalTimeline({
  entries,
  keyConnection,
}: {
  entries: TimelineEntry[];
  keyConnection: KeyConnection;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ol className="relative flex flex-col gap-6 border-l-2 border-blue-200 pl-6">
        {entries.map((entry) => (
          <li key={`${entry.sourceType}-${entry.sourceId}`} className="relative">
            <span className="absolute -left-[29px] top-1 size-3 rounded-full bg-blue-600" />
            <p className="text-xs font-medium text-slate-400">{entry.date}</p>
            <p className="text-sm font-medium text-slate-900">{entry.label}</p>
            <div className="mt-1">
              <SourceEvidence
                sourceType={entry.sourceType}
                sourceId={entry.sourceId}
                label="View source"
              />
            </div>
          </li>
        ))}
      </ol>

      {keyConnection && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-base text-blue-900">Key insight — for clinician review</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-blue-950">{keyConnection.statement}</p>
            <p className="text-xs font-medium uppercase text-blue-700">
              Confidence: {keyConnection.confidence}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
