import { generateText, Output } from "ai";
import { COST_EXPLAINER_PROMPT, SYSTEM_PROMPT } from "@/lib/agent/prompts";
import { ClinicalDraftSchema, type ClinicalDraftOutput } from "@/lib/agent/schemas";
import { demoClinicalDraft } from "@/lib/demo-fixtures";
import { formatCents, formatDollars } from "@/lib/format-money";
import { flags } from "@/lib/flags";
import type {
  ClinicalDraft,
  CostEstimate,
  CostExplanation,
  PatientContext,
  TranscriptEvent,
} from "@/types";

// LLM access goes through the Vercel AI Gateway (doc section 3: "provider
// available through Deepgram or direct model API"). Auth is VERCEL_OIDC_TOKEN,
// provisioned by `vercel env pull` — no per-provider key. Plain
// "provider/model" strings resolve through the gateway automatically.
//
// Scope boundary, per doc section 3 ("keep the agent workflow deterministic")
// and issue #11: the model chooses WORDING ONLY. It never selects the next
// state, never decides a safety outcome, and never emits consent or disclaimer
// copy — those stay verbatim in orchestrator.ts and safety.ts.

const QUESTION_TIMEOUT_MS = 8_000;
const DRAFT_TIMEOUT_MS = 20_000;
const COST_TIMEOUT_MS = 10_000;

// Longer than a spoken reply — this is read on screen, not heard — but still
// capped so the panel cannot be flooded.
const MAX_COST_WORDS = 130;

// Doc section 7 rule 9 caps spoken replies at 35 words. Allow a small grace
// margin, then fall back rather than speak a rambling line during the demo.
const MAX_REPLY_WORDS = 45;

export type LlmSource = "live" | "fixture";

export type LlmReply = {
  text: string;
  source: LlmSource;
};

export type LlmDraft = {
  draft: ClinicalDraftOutput;
  source: LlmSource;
};

function chartFacts(context: PatientContext | null): string {
  if (!context) return "No chart context loaded.";
  const lines: string[] = [`Patient: ${context.name}, age ${context.age}.`];
  for (const med of context.medications) {
    lines.push(
      `Medication: ${med.name} (${med.status}), started ${med.startDate ?? "unknown date"} [${med.fhirId}]`
    );
  }
  for (const condition of context.conditions) {
    lines.push(
      `Condition: ${condition.name}, onset ${condition.onsetDate ?? "unknown"} [${condition.fhirId}]`
    );
  }
  for (const allergy of context.allergies) {
    lines.push(`Allergy: ${allergy.substance} — ${allergy.reaction ?? "reaction unknown"}`);
  }
  for (const doc of context.priorDocuments) {
    lines.push(
      `Prior document: ${doc.title} (${doc.date ?? "undated"}) [${doc.fhirId}] — ${doc.excerpt ?? ""}`
    );
  }
  return lines.join("\n");
}

function transcriptText(transcript: TranscriptEvent[]): string {
  if (transcript.length === 0) return "No prior turns.";
  return transcript
    .map((event) => `${event.speaker === "patient" ? "PATIENT" : "AGENT"}: ${event.text}`)
    .join("\n");
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Phrase the next question. `intent` is the deterministic question the state
 * machine has already decided to ask — the model may only rephrase it so it
 * follows naturally from what the patient just said, grounded in chart facts.
 * Any failure, timeout, or over-long reply returns `intent` unchanged, so the
 * scripted demo path always survives (doc section 10 fallback ladder).
 */
export async function generateQuestion({
  intent,
  utterance,
  patientContext,
  transcript,
}: {
  intent: string;
  utterance: string;
  patientContext: PatientContext | null;
  transcript: TranscriptEvent[];
}): Promise<LlmReply> {
  if (!flags.useLiveLlm) return { text: intent, source: "fixture" };

  try {
    const result = await generateText({
      model: flags.llmModel,
      system: SYSTEM_PROMPT,
      maxRetries: 0,
      timeout: QUESTION_TIMEOUT_MS,
      prompt: `Chart facts (the only facts you may treat as chart-derived):
${chartFacts(patientContext)}

Conversation so far:
${transcriptText(transcript)}

The patient just said: "${utterance}"

Ask this next question: "${intent}"

Rephrase it so it follows naturally from what the patient just said. You may
reference a chart fact above if it makes the question clearer. Do not change
what is being asked, do not ask anything additional, and do not answer it
yourself. Never state a fact that is not in the chart facts or the
conversation. Reply with the question only — no preamble, one question, under
35 words.`,
    });

    const text = result.text.trim();
    if (!text || wordCount(text) > MAX_REPLY_WORDS) {
      console.warn("[llm] question rejected, using scripted intent", {
        words: wordCount(text),
        text: text.slice(0, 120),
      });
      return { text: intent, source: "fixture" };
    }
    return { text, source: "live" };
  } catch (error) {
    console.warn("[llm] question generation failed, using scripted intent", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { text: intent, source: "fixture" };
  }
}

/**
 * The estimate as prompt lines. Every number the model is allowed to say appears
 * here — the prompt forbids any other, which is only enforceable because this is
 * the complete set.
 */
function costFacts(estimate: CostEstimate): string {
  const lines = [
    `Visit: ${estimate.serviceDescription}`,
    `Plan: ${estimate.planName} (${estimate.network})`,
    `Full price the clinic has agreed with the plan: ${formatCents(estimate.allowedAmountCents)}`,
    `Deductible still owed before this visit: ${formatCents(estimate.deductibleRemainingCents)}`,
    `Amount of that deductible this visit uses up: ${formatCents(estimate.deductibleAppliedCents)}`,
  ];
  if (estimate.coinsuranceRate !== null) {
    lines.push(
      `Coinsurance rate after the deductible: ${Math.round(estimate.coinsuranceRate * 100)}%`,
      `Coinsurance owed on this visit: ${formatCents(estimate.coinsuranceCents)}`
    );
  }
  if (estimate.copayCents > 0) lines.push(`Copay: ${formatCents(estimate.copayCents)}`);
  lines.push(
    `Insurance pays: ${formatCents(estimate.insurancePaysCents)}`,
    `Patient pays: ${formatCents(estimate.patientPaysCents)}`,
    `Likely range: ${formatDollars(estimate.lowCents)} to ${formatDollars(estimate.highCents)}`,
    `Confidence: ${estimate.confidence} (${estimate.confidencePct}%)`,
    `Could change if: ${estimate.couldChange.join("; ")}`
  );
  return lines.join("\n");
}

/**
 * The explanation when the model is off or fails. Templated from the same
 * numbers, so the Cost panel is fully usable with USE_LIVE_LLM=false — the model
 * improves the wording, it is not load-bearing for the screen.
 */
function scriptedCostExplanation(estimate: CostEstimate): string {
  const you = formatDollars(estimate.patientPaysCents);
  const parts: string[] = [];

  if (estimate.deductibleAppliedCents > 0) {
    parts.push(
      `You have ${formatDollars(estimate.deductibleAppliedCents)} left on your deductible — the amount you pay yourself before your plan starts covering costs — so that part of this visit is yours`
    );
  }
  if (estimate.coinsuranceCents > 0 && estimate.coinsuranceRate !== null) {
    parts.push(
      `after that, your plan covers most of the rest and you pay ${Math.round(estimate.coinsuranceRate * 100)}% of what is left, which comes to ${formatDollars(estimate.coinsuranceCents)}`
    );
  }
  if (estimate.copayCents > 0) {
    parts.push(
      `your deductible is already met, so you owe a flat ${formatDollars(estimate.copayCents)} copay`
    );
  }

  const body = parts.length
    ? `${parts.join(", and ")}. `
    : `Your plan covers ${formatDollars(estimate.insurancePaysCents)} of the ${formatDollars(estimate.allowedAmountCents)} cost. `;

  return `${body}That puts your share at about ${you}, likely between ${formatDollars(estimate.lowCents)} and ${formatDollars(estimate.highCents)}. This is an estimate, not a bill — it changes if anything extra is done during the visit, like lab work or a biopsy.`;
}

/**
 * Explain a computed cost estimate in plain English, or answer a follow-up
 * question about it. The model receives the finished breakdown and may only
 * describe it — it never calculates, and every number it is permitted to use is
 * listed in costFacts() above.
 *
 * Falls back to scriptedCostExplanation() on any failure, so the panel works
 * with the model off (doc section 10 fallback ladder).
 */
export async function explainCost({
  estimate,
  question,
}: {
  estimate: CostEstimate;
  question?: string;
}): Promise<CostExplanation> {
  const fallback: CostExplanation = {
    text: scriptedCostExplanation(estimate),
    source: "fixture",
  };

  if (!flags.useLiveLlm) return fallback;

  const task = question?.trim()
    ? `The patient asked: "${question.trim()}"

Answer that question using only the breakdown above. If the answer is not in the
breakdown, say plainly that you do not have that detail and suggest they ask the
clinic. Do not speculate.`
    : `Explain in plain English what this patient will pay and why.`;

  try {
    const result = await generateText({
      model: flags.llmModel,
      system: COST_EXPLAINER_PROMPT,
      maxRetries: 0,
      timeout: COST_TIMEOUT_MS,
      prompt: `Cost breakdown (the only numbers you may state):
${costFacts(estimate)}

${task}`,
    });

    const text = result.text.trim();
    if (!text || wordCount(text) > MAX_COST_WORDS) {
      console.warn("[llm] cost explanation rejected, using scripted copy", {
        words: wordCount(text),
      });
      return fallback;
    }
    return { text, source: "live" };
  } catch (error) {
    console.warn("[llm] cost explanation failed, using scripted copy", {
      message: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

/**
 * Produce the schema-valid clinician draft. Retries once on malformed output,
 * then falls back to the committed demo draft (issue #11 / doc section 10:
 * "LLM output is malformed -> use deterministic demo draft fixture after one
 * retry"). Safety flags are NOT sourced from the model — the caller overwrites
 * them with the deterministic screen result.
 */
export async function generateDraft({
  patientContext,
  transcript,
  currentDraft,
}: {
  patientContext: PatientContext | null;
  transcript: TranscriptEvent[];
  currentDraft: ClinicalDraft;
}): Promise<LlmDraft> {
  const fixture: LlmDraft = {
    draft: ClinicalDraftSchema.parse({
      chiefConcern: demoClinicalDraft.chiefConcern,
      historyOfPresentIllness: demoClinicalDraft.historyOfPresentIllness,
      timeline: demoClinicalDraft.timeline,
      safetyFlags: demoClinicalDraft.safetyFlags,
      keyConnection: demoClinicalDraft.keyConnection,
      unresolvedQuestions: demoClinicalDraft.unresolvedQuestions,
      clinicianReviewNotes: demoClinicalDraft.clinicianReviewNotes,
      patientFriendlySummary: demoClinicalDraft.patientFriendlySummary,
    }),
    source: "fixture",
  };

  if (!flags.useLiveLlm) return fixture;

  const prompt = `Chart facts (cite these sourceIds — never invent one):
${chartFacts(patientContext)}

Full pre-visit conversation:
${transcriptText(transcript)}

Draft in progress (extend it; keep anything still accurate):
${JSON.stringify(
  {
    chiefConcern: currentDraft.chiefConcern,
    historyOfPresentIllness: currentDraft.historyOfPresentIllness,
    timeline: currentDraft.timeline,
  },
  null,
  2
)}

Produce the structured clinician draft. Requirements:
- Separate patient-reported statements from chart-derived facts.
- Every timeline entry must use a sourceType and sourceId from the chart facts.
- keyConnection states a timing relationship only if the dates support it, with
  an honest confidence and the sourceIds it rests on. Use null if unsupported.
- unresolvedQuestions are what the clinician still needs to ask.
- patientFriendlySummary is plain language, no diagnosis, and says the clinician
  will review this.
- Do not diagnose, do not recommend stopping or changing any medication.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateText({
        model: flags.llmModel,
        system: SYSTEM_PROMPT,
        maxRetries: 0,
        timeout: DRAFT_TIMEOUT_MS,
        prompt,
        output: Output.object({
          schema: ClinicalDraftSchema,
          name: "clinical_draft",
          description: "Structured pre-visit draft for clinician review.",
        }),
      });

      const parsed = ClinicalDraftSchema.safeParse(result.output);
      if (parsed.success) return { draft: parsed.data, source: "live" };
      console.warn("[llm] draft failed schema validation", {
        attempt: attempt + 1,
        issues: parsed.error.issues.slice(0, 3),
      });
    } catch (error) {
      console.warn("[llm] draft generation threw", {
        attempt: attempt + 1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.warn("[llm] falling back to demo draft fixture after 2 attempts");
  return fixture;
}
