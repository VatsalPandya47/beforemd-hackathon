// Feature flags per doc section 6. Every sponsor integration can be forced to
// its fixture path without touching the UI or adapter call sites.

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true";
}

export const flags = {
  demoMode: process.env.NEXT_PUBLIC_DEMO_MODE ?? "live",
  allowFixtureFallback: readBool(process.env.ALLOW_FIXTURE_FALLBACK, true),
  useLiveMedplum: readBool(process.env.USE_LIVE_MEDPLUM, false),
  useLiveDeepgram: readBool(process.env.USE_LIVE_DEEPGRAM, false),
  useLiveMoss: readBool(process.env.USE_LIVE_MOSS, false),
  useLiveStedi: readBool(process.env.USE_LIVE_STEDI, false),
};

export const demoIds = {
  patientFhirId: process.env.DEMO_PATIENT_FHIR_ID ?? "",
  encounterFhirId: process.env.DEMO_ENCOUNTER_FHIR_ID ?? "",
  appointmentFhirId: process.env.DEMO_APPOINTMENT_FHIR_ID ?? "",
};
