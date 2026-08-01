import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ApproveResponse } from "@/types";

// Approval is where the provenance claim has to become visible (doc section 2):
// the resources we just created, not a button that changed colour.
//
// Deliberately not SourceEvidence, which the timeline uses: that component keeps
// its id in a tooltip and labels every chip "View source". Here the id *is* the
// payload and it gets read off a projector from several feet away (doc section
// 8), so it renders inline.

const RESOURCES = [
  {
    field: "questionnaireResponseFhirId",
    resourceType: "QuestionnaireResponse",
    caption: "What the patient answered",
  },
  {
    field: "clinicalImpressionFhirId",
    resourceType: "ClinicalImpression",
    caption: "The draft summary",
  },
  {
    field: "taskFhirId",
    resourceType: "Task",
    caption: "Review task for the clinician",
  },
] as const;

export function WriteBackEvidence({ writeBack }: { writeBack: ApproveResponse }) {
  // Anything other than a live write — today only the fixture branch, but
  // "cache" would be just as untrue — is labelled as not having reached Medplum.
  const isLive = writeBack.source === "live";

  return (
    <Card
      className={cn(
        "bg-emerald-50/70 ring-emerald-600/25",
        !isLive && "bg-amber-50/70 ring-amber-600/30"
      )}
    >
      <CardHeader>
        <CardTitle className="text-base text-slate-900">
          {isLive ? "Saved to the patient's chart" : "Approval recorded — chart not written"}
        </CardTitle>
        <CardAction>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold",
              isLive
                ? "bg-emerald-600 text-white"
                : "bg-amber-500 text-amber-950"
            )}
          >
            {isLive ? "Written to Medplum" : "Fixture — nothing written"}
          </span>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {!isLive && (
          <p className="text-xs text-amber-900">
            Medplum is running on its fixture path, so these are placeholder ids.
            No FHIR resources were created for this session.
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          {RESOURCES.map(({ field, resourceType, caption }) => {
            const id = writeBack[field];

            return (
              <Tooltip key={field}>
                <TooltipTrigger
                  className={cn(
                    "cursor-default rounded-lg bg-white/80 px-3 py-2 text-left ring-1 ring-slate-900/10",
                    "hover:ring-slate-900/25"
                  )}
                >
                  <span className="block text-sm font-semibold text-slate-900">
                    {resourceType}
                  </span>
                  {/* break-all, not truncate: a half-shown FHIR id is not
                      evidence of anything. */}
                  <span className="block font-mono text-xs break-all text-slate-700">
                    {id || "id not returned"}
                  </span>
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {caption}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {id ? `${resourceType}/${id}` : `${resourceType} was created without an id`}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
