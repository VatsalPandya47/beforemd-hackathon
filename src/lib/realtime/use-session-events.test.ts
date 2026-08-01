import assert from "node:assert/strict";
import test from "node:test";
import {
  appendOptimisticEvent,
  markAsHistory,
  mergeAgentEvent,
  mergeTranscriptEvent,
  type DisplayTranscriptEvent,
} from "./use-session-events.ts";
import type { AgentEvent, TranscriptEvent, TranscriptSpeaker } from "@/types";

// Run with: npm run test:realtime
//
// Every line on the intake transcript can arrive from two directions — appended
// by the turn that caused it, and delivered as a committed row by Realtime — and
// the order is a race the browser does not control. #43 shipped handling only the
// order a local stack happened to produce, and the other order doubled every
// agent reply in front of the team. Reading the merge did not reveal that; running
// both orders does, so both orders are asserted here.
//
// The helpers are pure by design for exactly this reason: the hook hands deltas
// back to the screen rather than owning the transcript.

function row(id: number, speaker: TranscriptSpeaker, text: string): TranscriptEvent {
  return { id, sessionId: "s", speaker, text, isFinal: true, sequenceNo: id, createdAt: "" };
}

// What the screen appends before the row exists: negative id, never persisted.
function local(n: number, speaker: TranscriptSpeaker, text: string): DisplayTranscriptEvent {
  return { id: -n, sessionId: "s", speaker, text, isFinal: true, sequenceNo: n, createdAt: "" };
}

// Through the same call hydration makes, so this covers the hook's mapping rather
// than a local imitation of it.
function history(id: number, speaker: TranscriptSpeaker, text: string): DisplayTranscriptEvent {
  return markAsHistory(row(id, speaker, text));
}

const lines = (events: DisplayTranscriptEvent[]) =>
  events.map((event) => `${event.speaker}:${event.text}`);

test("the response winning the race shows each line once", () => {
  let t: DisplayTranscriptEvent[] = [];
  t = appendOptimisticEvent(t, local(1, "patient", "Hello?"));
  t = appendOptimisticEvent(t, local(2, "agent", "Hi, I'm BeforeMD"));
  t = mergeTranscriptEvent(t, row(10, "patient", "Hello?"));
  t = mergeTranscriptEvent(t, row(11, "agent", "Hi, I'm BeforeMD"));

  assert.deepEqual(lines(t), ["patient:Hello?", "agent:Hi, I'm BeforeMD"]);
});

test("the committed row winning the race shows each line once", () => {
  // The order that doubled the greeting on main: api/agent/turn inserts both
  // rows before it responds, so Realtime can deliver them first.
  let t: DisplayTranscriptEvent[] = [];
  t = appendOptimisticEvent(t, local(1, "patient", "Hello?"));
  t = mergeTranscriptEvent(t, row(10, "patient", "Hello?"));
  t = mergeTranscriptEvent(t, row(11, "agent", "Hi, I'm BeforeMD"));
  t = appendOptimisticEvent(t, local(2, "agent", "Hi, I'm BeforeMD"));

  assert.deepEqual(lines(t), ["patient:Hello?", "agent:Hi, I'm BeforeMD"]);
});

test("a repeated utterance stays two lines in either order", () => {
  let responseFirst: DisplayTranscriptEvent[] = [];
  responseFirst = appendOptimisticEvent(responseFirst, local(1, "patient", "Yes"));
  responseFirst = mergeTranscriptEvent(responseFirst, row(10, "patient", "Yes"));
  responseFirst = appendOptimisticEvent(responseFirst, local(2, "patient", "Yes"));
  responseFirst = mergeTranscriptEvent(responseFirst, row(11, "patient", "Yes"));
  assert.deepEqual(lines(responseFirst), ["patient:Yes", "patient:Yes"]);

  let rowFirst: DisplayTranscriptEvent[] = [];
  rowFirst = appendOptimisticEvent(rowFirst, local(1, "patient", "Yes"));
  rowFirst = mergeTranscriptEvent(rowFirst, row(10, "patient", "Yes"));
  rowFirst = mergeTranscriptEvent(rowFirst, row(11, "patient", "Yes"));
  rowFirst = appendOptimisticEvent(rowFirst, local(2, "patient", "Yes"));
  assert.deepEqual(lines(rowFirst), ["patient:Yes", "patient:Yes"]);
});

test("repeating a line that is already in the loaded history still shows it", () => {
  // Reported in review of #48. Hydrated rows left claimable meant a later "Yes"
  // consumed the historical one and never appeared — a silently missing line,
  // which is worse on a demo screen than a visible duplicate.
  let t: DisplayTranscriptEvent[] = [
    history(1, "patient", "Yes"),
    history(2, "agent", "Thanks."),
  ];

  t = appendOptimisticEvent(t, local(1, "patient", "Yes"));

  assert.deepEqual(lines(t), ["patient:Yes", "agent:Thanks.", "patient:Yes"]);
  assert.equal(t[2].id < 0, true, "the new line is still waiting for its own row");

  // And its own row adopts it rather than appending a third copy.
  t = mergeTranscriptEvent(t, row(12, "patient", "Yes"));
  assert.deepEqual(lines(t), ["patient:Yes", "agent:Thanks.", "patient:Yes"]);
  assert.equal(t[2].id, 12);
});

test("hydration folded over lines already on screen adds nothing", () => {
  let t: DisplayTranscriptEvent[] = [];
  t = appendOptimisticEvent(t, local(1, "patient", "Hello?"));
  t = appendOptimisticEvent(t, local(2, "agent", "Hi"));

  t = [row(10, "patient", "Hello?"), row(11, "agent", "Hi")].reduce(mergeTranscriptEvent, t);

  assert.deepEqual(lines(t), ["patient:Hello?", "agent:Hi"]);
});

test("a watching screen ignores a row delivered twice", () => {
  let t: DisplayTranscriptEvent[] = [];
  t = mergeTranscriptEvent(t, row(10, "patient", "Hello?"));
  t = mergeTranscriptEvent(t, row(11, "agent", "Hi"));
  t = mergeTranscriptEvent(t, row(11, "agent", "Hi"));

  assert.deepEqual(lines(t), ["patient:Hello?", "agent:Hi"]);
});

function toolEvent(id: number, title: string): AgentEvent {
  return {
    id,
    sessionId: "s",
    eventType: "tool_started",
    toolName: "get_patient_context",
    title,
    payload: {},
    sequenceNo: id,
    createdAt: "",
  };
}

test("the rail dedupes tool events on their database id", () => {
  let a: AgentEvent[] = [];
  a = mergeAgentEvent(a, toolEvent(5, "Reviewing medication history"));
  a = [toolEvent(5, "Reviewing medication history"), toolEvent(6, "Reviewed medication history")]
    .reduce(mergeAgentEvent, a);

  assert.deepEqual(a.map((event) => event.title), [
    "Reviewing medication history",
    "Reviewed medication history",
  ]);
});

test("the rail keeps a title that legitimately repeats across turns", () => {
  // Every turn reviews medication history, so identical titles with distinct ids
  // are normal and must not collapse.
  const a = [toolEvent(5, "Reviewing medication history"), toolEvent(9, "Reviewing medication history")]
    .reduce(mergeAgentEvent, [] as AgentEvent[]);

  assert.equal(a.length, 2);
});
