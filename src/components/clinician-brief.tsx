import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ClinicalTimeline } from "@/components/clinical-timeline";
import { CoverageCard } from "@/components/coverage-card";
import type { ClinicalDraft } from "@/types";

export function ClinicianBrief({
  draft,
  onApprove,
}: {
  draft: ClinicalDraft;
  onApprove?: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{draft.chiefConcern}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Onset</p>
            <p>{draft.historyOfPresentIllness.onset ?? "Unknown"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Location</p>
            <p>{draft.historyOfPresentIllness.location ?? "Unknown"}</p>
          </div>
        </CardContent>
      </Card>

      <ClinicalTimeline entries={draft.timeline} keyConnection={draft.keyConnection} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Unresolved questions</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-5 text-sm text-slate-700">
            {draft.unresolvedQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {draft.coverageSummary && <CoverageCard coverage={draft.coverageSummary} />}

      <Separator />

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Draft is unverified until a clinician approves it.
        </p>
        <Button onClick={onApprove} disabled={draft.clinicianStatus === "approved"}>
          {draft.clinicianStatus === "approved" ? "Approved" : "Approve draft"}
        </Button>
      </div>
    </div>
  );
}
