import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBlanketDenial,
  checkSafetyRedFlags,
  hasActiveRedFlag,
  initialSafetyFlags,
  isBlanketDenial,
  type SafetyRedFlag,
} from "./safety.ts";

// Run with: npm run test:safety
//
// The red-flag screen is the one deterministic safety control in the product,
// and both bugs it has shipped with were scoping bugs that reading the code did
// not reveal — they needed the utterance run through it. Cases here are written
// the way patients speak, including unpunctuated forms, because the real input
// is Deepgram transcription rather than typed text.

function statusOf(utterance: string, flag: SafetyRedFlag) {
  return checkSafetyRedFlags(utterance).find((entry) => entry.name === flag)?.status;
}

function escalates(utterance: string) {
  return hasActiveRedFlag(checkSafetyRedFlags(utterance));
}

test("reports symptoms described the way patients actually speak", () => {
  const reported: [string, SafetyRedFlag][] = [
    ["Yes, I'm having trouble breathing", "breathing difficulty"],
    ["I can't breathe properly", "breathing difficulty"],
    ["I'm short of breath", "breathing difficulty"],
    ["My face is swelling up", "facial or mouth swelling"],
    ["my lips are swollen", "facial or mouth swelling"],
    ["my throat is closing", "facial or mouth swelling"],
    ["I have a fever", "fever"],
    ["I have sores in my mouth", "mucosal sores"],
    ["it started blistering", "blistering"],
    ["It's spreading really fast", "rapid spread"],
    ["The pain is unbearable", "severe pain"],
  ];

  for (const [utterance, flag] of reported) {
    assert.equal(statusOf(utterance, flag), "present", utterance);
    assert.ok(escalates(utterance), `should escalate: ${utterance}`);
  }
});

test("treats denials as denials rather than mentions", () => {
  for (const utterance of [
    "No fever, no swelling, no sores",
    "I do not have a fever",
    "No blistering at all",
    "no trouble breathing",
    "no swollen lips",
    "The rash is itchy but not painful",
  ]) {
    assert.equal(escalates(utterance), false, `should not escalate: ${utterance}`);
  }

  assert.equal(statusOf("I do not have a fever", "fever"), "absent");
});

// Regression: a denial used to reach forward to the next punctuation mark, so
// any connector that was not enumerated let it swallow a real symptom. Live
// transcription often has no punctuation at all, which made this the likeliest
// shape of a missed emergency rather than an unusual one.
test("a denial binds only to the symptom it precedes", () => {
  const cases: [string, SafetyRedFlag][] = [
    ["no i dont have a fever im having trouble breathing though", "breathing difficulty"],
    ["I dont have a fever my throat is closing", "facial or mouth swelling"],
    ["no fever my face is swelling", "facial or mouth swelling"],
    ["no fever so far however the rash is spreading really fast", "rapid spread"],
    ["no fever um I'm having trouble breathing", "breathing difficulty"],
    ["no fever - I'm having trouble breathing", "breathing difficulty"],
    ["no fever, I'm having trouble breathing", "breathing difficulty"],
    ["no fever but the rash is blistering", "blistering"],
  ];

  for (const [utterance, flag] of cases) {
    assert.equal(statusOf(utterance, flag), "present", utterance);
    assert.ok(escalates(utterance), `should escalate: ${utterance}`);
  }

  // The denied symptom in those same utterances stays denied.
  assert.equal(statusOf("no fever my face is swelling", "fever"), "absent");
});

test("a denial carries across a list but not across new content", () => {
  assert.equal(statusOf("no fever or blistering", "blistering"), "absent");
  assert.equal(statusOf("no fever my face is swelling", "facial or mouth swelling"), "present");
});

test("a negative verb inside a symptom is not a denial of it", () => {
  const flags = checkSafetyRedFlags("I cant breathe and my face is swelling");
  assert.equal(flags.find((f) => f.name === "breathing difficulty")?.status, "present");
  assert.equal(flags.find((f) => f.name === "facial or mouth swelling")?.status, "present");
});

test("a reported flag stays reported on later turns", () => {
  const first = checkSafetyRedFlags("I can't breathe");
  const second = checkSafetyRedFlags("actually never mind, lets continue", first);
  assert.equal(second.find((f) => f.name === "breathing difficulty")?.status, "present");
  assert.ok(hasActiveRedFlag(second));
});

test("blanket denial covers the compound question, mixed answers do not", () => {
  assert.ok(isBlanketDenial("No, none of those"));
  assert.ok(isBlanketDenial("no"));
  assert.ok(isBlanketDenial("nope"));
  assert.equal(isBlanketDenial("no trouble breathing"), false);
  assert.equal(isBlanketDenial("no fever but the rash is blistering"), false);

  const denied = applyBlanketDenial(checkSafetyRedFlags("No, none of those"));
  assert.ok(denied.every((flag) => flag.status === "absent"));
});

test("a fresh session has screened nothing", () => {
  assert.ok(initialSafetyFlags().every((flag) => flag.status === "unknown"));
  assert.equal(hasActiveRedFlag(initialSafetyFlags()), false);
});
