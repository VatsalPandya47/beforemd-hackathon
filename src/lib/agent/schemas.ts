import { z } from "zod";

// Exact structured output contract from doc section 7. The LLM must produce
// data matching this shape; do not loosen it to work around a bad model output
// — retry once, then fall back to the demo draft fixture (see safety.ts).
export const ClinicalDraftSchema = z.object({
  chiefConcern: z.string(),
  historyOfPresentIllness: z.object({
    onset: z.string().nullable(),
    location: z.string().nullable(),
    duration: z.string().nullable(),
    characteristics: z.array(z.string()),
    aggravatingFactors: z.array(z.string()),
    relievingFactors: z.array(z.string()),
    associatedSymptoms: z.array(z.string()),
  }),
  timeline: z.array(
    z.object({
      date: z.string(),
      label: z.string(),
      sourceType: z.string(),
      sourceId: z.string(),
    })
  ),
  safetyFlags: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["present", "absent", "unknown"]),
    })
  ),
  keyConnection: z
    .object({
      statement: z.string(),
      confidence: z.enum(["low", "moderate", "high"]),
      evidenceSourceIds: z.array(z.string()),
    })
    .nullable(),
  unresolvedQuestions: z.array(z.string()),
  clinicianReviewNotes: z.array(z.string()),
  patientFriendlySummary: z.string(),
});

export type ClinicalDraftOutput = z.infer<typeof ClinicalDraftSchema>;
