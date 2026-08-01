import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ClinicalTimeline } from "@/components/clinical-timeline";
import { CoverageCard } from "@/components/coverage-card";
import { WriteBackEvidence } from "@/components/write-back-evidence";
import type { ApproveResponse, ClinicalDraft } from "@/types";

export function ClinicianBrief({
  draft,
  onApprove,
  writeBack = null,
  approveError = null,
  isApproving = false,
}: {
  draft: ClinicalDraft;
  onApprove?: () => void;
  /** What the approve call reported creating in Medplum. */
  writeBack?: ApproveResponse | null;
  approveError?: string | null;
  isApproving?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          {/* The chief concern is the headline of the whole brief. */}
          <CardTitle className="text-2xl leading-snug">{draft.chiefConcern}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-base">
          <div>
            <p className="text-sm text-muted-foreground">Onset</p>
            <p className="font-medium">{draft.historyOfPresentIllness.onset ?? "Unknown"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Location</p>
            <p className="font-medium">{draft.historyOfPresentIllness.location ?? "Unknown"}</p>
          </div>
        </CardContent>
      </Card>

      <ClinicalTimeline entries={draft.timeline} keyConnection={draft.keyConnection} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Unresolved questions</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-base text-slate-700">
            {draft.unresolvedQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {draft.coverageSummary && <CoverageCard coverage={draft.coverageSummary} />}

      <Separator />

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Draft is unverified until a clinician approves it.
        </p>
        <Button
          size="lg"
          className="h-12 px-6 text-base"
          onClick={onApprove}
          disabled={isApproving || draft.clinicianStatus === "approved"}
        >
          {draft.clinicianStatus === "approved"
            ? "Approved"
            : isApproving
              ? "Saving to chart…"
              : "Approve draft"}
        </Button>
      </div>

      {approveError && (
        <Card className="bg-red-50/70 ring-red-600/25">
          <CardHeader>
            <CardTitle className="text-base text-red-900">
              Nothing was saved to the chart
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p role="alert" className="text-sm text-red-950">
              {approveError}
            </p>
            <p className="text-xs text-red-900/80">
              The draft is still unapproved. Approving again will retry the write.
            </p>
          </CardContent>
        </Card>
      )}

      {writeBack && <WriteBackEvidence writeBack={writeBack} />}
    </div>
  );
}
