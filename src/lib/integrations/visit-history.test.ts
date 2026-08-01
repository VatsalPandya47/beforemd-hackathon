import assert from "node:assert/strict";
import { test } from "node:test";
import type { Encounter } from "@medplum/fhirtypes";
import { splitVisits } from "./medplum";
import type { VisitSummary } from "@/types";

const NOW = Date.parse("2026-08-01T00:00:00.000Z");
const AFTER_THE_VISIT = Date.parse("2026-08-06T00:00:00.000Z");
const FUTURE = "2026-08-05T15:00:00.000Z";
const PAST = "2026-07-10T00:00:00.000Z";

function appointment(over: Partial<VisitSummary> = {}): VisitSummary {
  return {
    fhirId: "appt-1",
    resourceType: "Appointment",
    description: "Dermatology follow-up",
    date: FUTURE,
    status: "booked",
    practitionerFhirId: null,
    practitionerName: null,
    ...over,
  };
}

// Shaped like scripts/seed-medplum.mjs writes them: an Encounter may reference
// the Appointment it belongs to, whatever its own status.
function encounter(
  id: string,
  status: Encounter["status"],
  opts: { appointmentId?: string; start?: string } = {}
): Encounter {
  return {
    resourceType: "Encounter",
    id,
    status,
    class: { code: "AMB" },
    type: [{ text: "Dermatology consultation" }],
    period: { start: opts.start ?? PAST },
    ...(opts.appointmentId
      ? { appointment: [{ reference: `Appointment/${opts.appointmentId}` }] }
      : {}),
  };
}

// The same mapping getVisitHistory passes in, minus the practitioner lookup.
const toRow = (e: Encounter): VisitSummary => ({
  fhirId: e.id ?? "",
  resourceType: "Encounter",
  description: e.type?.[0]?.text ?? "Visit",
  date: e.period?.start ?? null,
  status: e.status ?? "unknown",
  practitionerFhirId: null,
  practitionerName: null,
});

const split = (appts: VisitSummary[], encs: Encounter[], now = NOW) =>
  splitVisits(appts, encs, toRow, now);

const ids = (rows: VisitSummary[]) => rows.map((r) => r.fhirId);

test("a future appointment is upcoming, a finished encounter is past", () => {
  const { upcoming, past } = split([appointment()], [encounter("enc-done", "finished")]);
  assert.deepEqual(ids(upcoming), ["appt-1"]);
  assert.deepEqual(ids(past), ["enc-done"]);
});

test("a planned encounter is neither upcoming nor past", () => {
  const { upcoming, past } = split([], [encounter("enc-intake", "planned")]);
  assert.deepEqual(ids(upcoming), []);
  assert.deepEqual(ids(past), []);
});

test("a planned encounter claiming the upcoming appointment does not hide it", () => {
  // The regression. The seeded planned intake Encounter references the upcoming
  // Appointment but produces no row of its own, so if it feeds the de-dup set
  // the appointment is suppressed from `past` the moment it stops being
  // upcoming — with nothing replacing it. The visit vanishes from the portal.
  const intake = encounter("enc-intake", "planned", { appointmentId: "appt-1" });

  const before = split([appointment()], [intake], NOW);
  assert.deepEqual(ids(before.upcoming), ["appt-1"]);

  const after = split([appointment()], [intake], AFTER_THE_VISIT);
  assert.deepEqual(ids(after.upcoming), []);
  assert.deepEqual(ids(after.past), ["appt-1"], "the visit disappeared from the portal");
});

test("a finished encounter suppresses the appointment it came from", () => {
  const done = appointment({ fhirId: "appt-past", date: PAST, status: "fulfilled" });
  const { past } = split(
    [done],
    [encounter("enc-done", "finished", { appointmentId: "appt-past" })]
  );
  assert.deepEqual(ids(past), ["enc-done"], "the visit was listed twice");
});

test("cancelled appointments are excluded from both lists", () => {
  const rows = [
    appointment({ fhirId: "cancelled-future", status: "cancelled" }),
    appointment({ fhirId: "noshow-past", date: PAST, status: "noshow" }),
    appointment({ fhirId: "bad", date: PAST, status: "entered-in-error" }),
    appointment(),
  ];
  const { upcoming, past } = split(rows, [encounter("enc-done", "finished")]);
  assert.deepEqual(ids(upcoming), ["appt-1"]);
  // Not merely absent from Upcoming: `past` sorts date-descending, so a cancelled
  // future appointment would otherwise head the list of visits that happened.
  assert.deepEqual(ids(past), ["enc-done"]);
});

test("upcoming sorts soonest first, past sorts most recent first", () => {
  const appts = [
    appointment({ fhirId: "later", date: "2026-09-01T00:00:00.000Z" }),
    appointment({ fhirId: "sooner", date: FUTURE }),
  ];
  const encs = [
    encounter("older", "finished", { start: "2026-01-01T00:00:00.000Z" }),
    encounter("newer", "finished", { start: PAST }),
  ];
  const { upcoming, past } = split(appts, encs);
  assert.deepEqual(ids(upcoming), ["sooner", "later"]);
  assert.deepEqual(ids(past), ["newer", "older"]);
});

test("an undated appointment is past, and sorts last", () => {
  const undated = appointment({ fhirId: "undated", date: null, status: "booked" });
  const { upcoming, past } = split([undated], [encounter("enc-done", "finished")]);
  assert.deepEqual(ids(upcoming), []);
  assert.deepEqual(ids(past), ["enc-done", "undated"]);
});
