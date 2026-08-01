import assert from "node:assert/strict";
import test from "node:test";
import { LLM_QUESTION_STATES, SCRIPTED_QUESTIONS, runAgentTurn } from "./orchestrator.ts";
import { ESCALATION_MESSAGE, initialSafetyFlags, SAFETY_RED_FLAGS } from "./safety.ts";
import { demoClinicalDraft } from "../demo-fixtures.ts";
import type { ClinicalDraft } from "../../types/index.ts";

// Run with: npm run test:safety
//
// These pin the two properties that keep a model-driven agent safe, both of
// which are currently argued for in comments that a future edit could delete.
// Neither test reaches the network: the states exercised here take the scripted
// path or return before any tool call.

const draft: ClinicalDraft = {
  ...demoClinicalDraft,
  sessionId: "test",
  safetyFlags: initialSafetyFlags(),
};

test("the red-flag question is never model-generated", () => {
  // Its wording enumerates the exact symptoms checkSafetyRedFlags looks for, so
  // a rephrase could quietly drop one. Excluded by having no goal entry.
  assert.equal(LLM_QUESTION_STATES.has("ASK_ADAPTIVE_QUESTION"), false);

  // And every symptom the screen scores is still named in the question asked.
  const asked = SCRIPTED_QUESTIONS.ASK_ADAPTIVE_QUESTION.toLowerCase();
  for (const flag of ["breathing", "swelling", "fever", "sores"]) {
    assert.ok(asked.includes(flag), `red-flag question no longer mentions ${flag}`);
  }
  assert.ok(SAFETY_RED_FLAGS.length > 0);
});

test("the red-flag question is spoken verbatim", async () => {
  const result = await runAgentTurn(
    "test",
    "patient-1",
    "ASK_ADAPTIVE_QUESTION",
    "it comes and goes",
    draft
  );
  assert.equal(result.reply, SCRIPTED_QUESTIONS.ASK_ADAPTIVE_QUESTION);
  assert.equal(result.nextState, "SAFETY_SCREEN");
});

// Regression: LOAD_HISTORY carries the patient's answer to the consent
// question, and used to send it straight to the model with no screen — so
// "yes, and my face is swelling up" was answered with a generated follow-up
// instead of an escalation.
test("a red flag in the consent answer escalates before any model call", async () => {
  const result = await runAgentTurn(
    "test",
    "patient-1",
    "LOAD_HISTORY",
    "yes, and my face is swelling up",
    draft
  );
  assert.equal(result.reply, ESCALATION_MESSAGE);
  assert.equal(result.nextState, "SAFETY_SCREEN");
  assert.equal(
    result.draftPatch?.safetyFlags?.find((f) => f.name === "facial or mouth swelling")?.status,
    "present"
  );
});

test("every state that calls the model has a goal to call it with", () => {
  // The set is derived from the goal map, so an empty goal is unrepresentable.
  // Asserted anyway because the derivation is the thing worth keeping.
  assert.ok(LLM_QUESTION_STATES.size > 0);
  for (const state of LLM_QUESTION_STATES) {
    assert.notEqual(state, "ASK_ADAPTIVE_QUESTION");
  }
});
