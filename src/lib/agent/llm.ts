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
// Scope boundary, per doc section 3 ("keep the agent workflow deterministic").
// The model chooses WHAT IT ASKS within a step whose goal the state machine
// fixed. It does not choose the next state, does not decide a safety outcome,
// and never emits consent, escalation or disclaimer copy — those stay verbatim
// in orchestrator.ts and safety.ts, and the red-flag screen runs before any
// model call on every turn.
//
// This is wider than the original "wording only" boundary, deliberately. With
// the model restricted to rephrasing a fixed intent, the agent answered a
// patient reporting a sore throat by asking whether their rash predated
// lamotrigine — it could not respond to anything the script had not
// anticipated. The safety-critical guarantees above are unchanged; what moved
// is the clinical content of ordinary questions.

// gpt-5-nano spends most of its wall time reasoning, and an 8s budget was
// under what even a one-line question took at default effort — every question
// call timed out, so the agent spoke the scripted fallback every turn and
// looked hard-coded. Asking a question is not a reasoning task; "low" brings
// it back to a couple of seconds, and the ceiling leaves room for a slow
// gateway without stalling the conversation.
// 10s, not more: this sits in the voice path where the patient is waiting, and
// silence is a failed demo whether or not an answer eventually arrives. At the
// measured ~6.1s that covers the tail with the fallback picking up the rest.
const QUESTION_TIMEOUT_MS = 10_000;

// Coupled to an OpenAI model. providerOptions is namespaced per provider, so
// pointing LLM_MODEL at a non-OpenAI model silently drops this and questions
// run at default effort again — which is what made every call exceed its
// timeout in the first place. Add the matching key if the model changes.
const QUESTION_REASONING_EFFORT = "low";

// The structured draft is a far bigger generation than a question — nine
// fields, several of them arrays. At the model's default reasoning effort it
// took 26.7s against the live gateway, over the 20s budget this once had, so
// every attempt was killed by our own timeout and the fixture served instead.
// The draft had never once succeeded here for that reason, independent of rate
// limiting. At reasoningEffort "low" it lands in ~8.7s; this ceiling leaves
// roughly 3x headroom for a slow gateway without parking the demo on a dead
// turn if the call is never coming back.
const DRAFT_TIMEOUT_MS = 30_000;

// Same lesson as the question path above, and the reason this is 15s rather
// than the 10s it started at: explaining a breakdown that is already computed
// is not a reasoning task, but at default effort gpt-5-nano treats it as one
// and blows any short budget. Nobody is waiting on a voice turn here — the
// numbers are already on screen — so the ceiling can be generous.
const COST_TIMEOUT_MS = 15_000;

// Same OpenAI-namespaced caveat as QUESTION_REASONING_EFFORT: pointing
// LLM_MODEL at a non-OpenAI model silently drops this.
const COST_REASONING_EFFORT = "low";

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
 * Ask the next question.
 *
 * `goal` is what this step of the state machine needs to establish; the model
 * decides what to actually ask in service of it, responding to what the patient
 * said rather than to a script. `fallback` is the scripted line for this step,
 * spoken verbatim whenever the model errors, times out, returns nothing, or
 * overruns the word cap — so the demo path survives a dead gateway (doc section
 * 10 fallback ladder).
 */
export async function generateQuestion({
  goal,
  fallback,
  utterance,
  patientContext,
  transcript,
}: {
  goal: string;
  fallback: string;
  utterance: string;
  patientContext: PatientContext | null;
  transcript: TranscriptEvent[];
}): Promise<LlmReply> {
  if (!flags.useLiveLlm) return { text: fallback, source: "fixture" };

  try {
    const result = await generateText({
      model: flags.llmModel,
      system: SYSTEM_PROMPT,
      maxRetries: 0,
      timeout: QUESTION_TIMEOUT_MS,
      providerOptions: { openai: { reasoningEffort: QUESTION_REASONING_EFFORT } },
      prompt: `Chart facts (the only facts you may treat as chart-derived):
${chartFacts(patientContext)}

Conversation so far:
${transcriptText(transcript)}

The patient just said: "${utterance}"

Your goal for this turn: ${goal}

Ask the single best next question that serves that goal and follows directly
from what the patient just said.

The chart above belongs to this patient, but it may have nothing to do with
what they are describing now. Follow what they actually said. If their concern
is unrelated to the chart, ask about their concern — do not steer the
conversation back to the chart, and do not imply their complaint is connected
to a medication or condition unless they raised it or the timing genuinely
suggests it.

Never state a fact that is not in the chart facts or the conversation. Do not
diagnose, do not answer your own question, and ask only one thing. Reply with
the question only — no preamble, under 35 words.`,
    });

    const text = result.text.trim();
    if (!text || wordCount(text) > MAX_REPLY_WORDS) {
      console.warn("[llm] question rejected, using scripted fallback", {
        words: wordCount(text),
        text: text.slice(0, 120),
      });
      return { text: fallback, source: "fixture" };
    }
    return { text, source: "live" };
  } catch (error) {
    console.warn("[llm] question generation failed, using scripted fallback", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { text: fallback, source: "fixture" };
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
      providerOptions: { openai: { reasoningEffort: COST_REASONING_EFFORT } },
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
- clinicianReviewNotes are what the reviewing clinician should check before the
  visit — what this draft rests on and where it is uncertain. Never empty.
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
        // gpt-5-nano spends most of its time reasoning, and this is an
        // extraction task rather than a reasoning one — the clinical judgement
        // is deliberately left to the reviewing clinician. Measured on the same
        // prompt: default 26.7s, low 8.7s, minimal 3.9s. "minimal" is fastest
        // but returns empty unresolvedQuestions, which is a rendered section of
        // the clinician brief, so "low" is the useful floor.
        providerOptions: { openai: { reasoningEffort: "low" } },
      });

      const parsed = ClinicalDraftSchema.safeParse(result.output);
      if (parsed.success) return { draft: parsed.data, source: "live" };
      console.warn("[llm] draft failed schema validation", {
        attempt: attempt + 1,
        issues: parsed.error.issues.slice(0, 3),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[llm] draft generation threw", { attempt: attempt + 1, message });

      // Retrying a timeout only buys a second timeout. The first attempt
      // already proved the model needs longer than we are willing to wait, so
      // a retry doubles the dead air on stage and changes nothing — a 20s
      // budget turned into a 42s turn this way. Retry is for a malformed or
      // transiently-failed response, not a slow one.
      if (/timeout|aborted/i.test(message)) {
        console.warn("[llm] draft timed out, not retrying — serving fixture");
        return fixture;
      }
    }
  }

  console.warn("[llm] falling back to demo draft fixture after 2 attempts");
  return fixture;
}
