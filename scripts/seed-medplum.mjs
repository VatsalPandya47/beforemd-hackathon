// Seeds the synthetic demo patient (Maya Thompson) into Medplum. Issue #7.
//
//   node scripts/seed-medplum.mjs --dry-run   # builds + asserts, no network, no creds
//   npm run seed:medplum                      # live, needs MEDPLUM_CLIENT_ID/SECRET
//
// Re-runnable: every resource carries the demo identifier below, and each run
// deletes everything bearing that identifier before creating fresh copies. The
// identifier is the guard — the script can never touch a resource it did not create.
//
// Synthetic data only. No real names, MRNs, or identifiable information.

import { readFileSync } from "node:fs";
import { MedplumClient } from "@medplum/core";

const DEMO_SYSTEM = "urn:beforemd:demo";
const DEMO_VALUE = "maya-thompson";
const identifier = [{ system: DEMO_SYSTEM, value: DEMO_VALUE }];

// Dates are hardcoded to match src/lib/demo-fixtures.ts exactly, so the live
// Medplum path and the fixture fallback render an identical timeline. Asserted below.
const LAMOTRIGINE_START = "2026-06-26";
const RASH_ONSET = "2026-07-07"; // 11 days after LAMOTRIGINE_START — the demo's key connection
const PRIOR_NOTE_DATE = "2026-07-10";
const MED_RESTART = "2026-07-22";
const APPOINTMENT_START = "2026-08-05T15:00:00.000Z";

const PRIOR_NOTE_TEXT =
  "Patient presented with pruritic rash on arms and torso. Improved with topical steroid.";

// --- resource builders -------------------------------------------------------

const patient = {
  resourceType: "Patient",
  identifier,
  active: true,
  // 1997 (not 1996): getPatientContext computes age by naive year subtraction,
  // so this renders 29 both there and in real arithmetic. See medplum.ts:67-69.
  birthDate: "1997-03-14",
  gender: "female",
  name: [{ text: "Maya Thompson", family: "Thompson", given: ["Maya"] }],
};

function dependents(patientId, appointmentId) {
  const subject = { reference: `Patient/${patientId}` };

  return [
    {
      resourceType: "Encounter",
      identifier,
      status: "planned",
      class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
      type: [{ text: "Pre-visit intake" }],
      subject,
      appointment: [{ reference: `Appointment/${appointmentId}` }],
    },
    {
      resourceType: "MedicationRequest",
      identifier,
      status: "active",
      intent: "order",
      medicationCodeableConcept: { text: "Lamotrigine 25 mg oral tablet" },
      subject,
      authoredOn: LAMOTRIGINE_START,
      dosageInstruction: [{ text: "Take one tablet by mouth daily." }],
    },
    {
      resourceType: "MedicationStatement",
      identifier,
      status: "active",
      medicationCodeableConcept: { text: "Lamotrigine 25 mg oral tablet" },
      subject,
      effectivePeriod: { start: MED_RESTART },
      note: [{ text: "Patient-reported: paused lamotrigine, then restarted it; rash returned afterward." }],
    },
    {
      resourceType: "Condition",
      identifier,
      clinicalStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "recurrence" }],
      },
      verificationStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }],
      },
      code: { text: "Recurring pruritic rash, arms and torso" },
      subject,
      onsetDateTime: RASH_ONSET,
    },
    {
      resourceType: "AllergyIntolerance",
      identifier,
      clinicalStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
      },
      type: "allergy",
      category: ["environment"],
      criticality: "low",
      // Deliberately NOT a drug allergy: a drug allergy already on the chart would
      // make the agent's medication-timing discovery look pre-known.
      code: { text: "Pollen (seasonal)" },
      patient: subject,
      reaction: [{ manifestation: [{ text: "Seasonal rhinitis" }], description: "Seasonal rhinitis, no rash" }],
    },
    {
      resourceType: "Observation",
      identifier,
      status: "final",
      category: [
        { coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey" }] },
      ],
      code: { text: "Patient-reported itch severity (0-10)" },
      subject,
      effectiveDateTime: RASH_ONSET,
      valueInteger: 6,
    },
    {
      resourceType: "DocumentReference",
      identifier,
      status: "current",
      type: { text: "Dermatology visit note" },
      // description is what getPatientContext maps to priorDocuments[].title
      description: "Dermatology visit note - first rash episode",
      subject,
      date: `${PRIOR_NOTE_DATE}T00:00:00.000Z`,
      content: [
        {
          attachment: {
            contentType: "text/plain",
            data: Buffer.from(PRIOR_NOTE_TEXT, "utf-8").toString("base64"),
          },
        },
      ],
    },
  ];
}

function appointment(patientId) {
  return {
    resourceType: "Appointment",
    identifier,
    status: "booked",
    serviceType: [{ text: "Dermatology" }],
    description: "Dermatology consultation - recurring rash",
    start: APPOINTMENT_START,
    end: new Date(Date.parse(APPOINTMENT_START) + 30 * 60_000).toISOString(),
    participant: [{ actor: { reference: `Patient/${patientId}` }, status: "accepted" }],
  };
}

// --- checks ------------------------------------------------------------------

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function check() {
  const fail = (msg) => {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  };

  const gap = daysBetween(LAMOTRIGINE_START, RASH_ONSET);
  if (gap !== 11) fail(`rash onset must be 11 days after lamotrigine start, got ${gap}`);

  if (Date.parse(MED_RESTART) <= Date.parse(RASH_ONSET)) fail("medication restart must come after the first rash onset");
  if (Date.parse(APPOINTMENT_START) <= Date.now()) fail(`appointment ${APPOINTMENT_START} is not in the future`);

  // Live Medplum and the fixture fallback must render the same timeline.
  const fixtures = readFileSync(new URL("../src/lib/demo-fixtures.ts", import.meta.url), "utf-8");
  for (const date of [LAMOTRIGINE_START, RASH_ONSET, PRIOR_NOTE_DATE]) {
    if (!fixtures.includes(date)) fail(`${date} is missing from src/lib/demo-fixtures.ts — live and fixture timelines would disagree`);
  }
  if (!fixtures.includes(PRIOR_NOTE_TEXT)) fail("prior note text does not match the excerpt in src/lib/demo-fixtures.ts");

  const built = [patient, appointment("X"), ...dependents("X", "Y")];
  for (const r of built) {
    if (!r.identifier?.[0]?.value) fail(`${r.resourceType} is missing the demo identifier — reseed would orphan it`);
  }

  return built;
}

// --- run ---------------------------------------------------------------------

const built = check();

// Derived from the builders, not hand-listed, so a new resource type can't be
// forgotten here and orphaned on the next reseed. Patient goes last — the rest
// reference it. Every type used declares an `identifier` search param in R4.
const seededTypes = [
  ...new Set(built.map((r) => r.resourceType).filter((t) => t !== "Patient")),
  "Patient",
];

if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify(built, null, 2));
  console.log(`\nReseed deletes, in order: ${seededTypes.join(", ")}`);
  console.log(
    process.exitCode
      ? "Dry run FAILED (see above)."
      : `Dry run OK — ${built.length} resources, rash onset ${daysBetween(LAMOTRIGINE_START, RASH_ONSET)} days after lamotrigine start.`
  );
  process.exit();
}

if (process.exitCode) process.exit(1);

const { MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET, MEDPLUM_BASE_URL } = process.env;
if (!MEDPLUM_CLIENT_ID || !MEDPLUM_CLIENT_SECRET) {
  console.error("MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET must be set (see .env.local). Use --dry-run to validate without credentials.");
  process.exit(1);
}

const medplum = new MedplumClient({ baseUrl: MEDPLUM_BASE_URL });
await medplum.startClientLogin(MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET);

let deleted = 0;
for (const resourceType of seededTypes) {
  const existing = await medplum.searchResources(resourceType, { identifier: `${DEMO_SYSTEM}|${DEMO_VALUE}` });
  for (const resource of existing) {
    await medplum.deleteResource(resourceType, resource.id);
    deleted++;
  }
}
if (deleted) console.log(`Removed ${deleted} resource(s) from a previous seed.`);

const created = [];
const createdPatient = await medplum.createResource(patient);
created.push(createdPatient);

const createdAppointment = await medplum.createResource(appointment(createdPatient.id));
created.push(createdAppointment);

for (const resource of dependents(createdPatient.id, createdAppointment.id)) {
  created.push(await medplum.createResource(resource));
}

const encounter = created.find((r) => r.resourceType === "Encounter");

console.log("\nSeeded:");
for (const r of created) console.log(`  ${r.resourceType.padEnd(20)} ${r.id}`);

console.log("\nPaste into .env.local (and the Vercel project env):\n");
console.log(`DEMO_PATIENT_FHIR_ID=${createdPatient.id}`);
console.log(`DEMO_APPOINTMENT_FHIR_ID=${createdAppointment.id}`);
console.log(`DEMO_ENCOUNTER_FHIR_ID=${encounter?.id ?? ""}`);
