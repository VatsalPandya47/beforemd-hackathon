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
  // Defaults true, unlike the sponsor flags: a missing gateway token makes the
  // call throw, and llm.ts already falls back to scripted copy on any failure.
  // Set USE_LIVE_LLM=false to force the scripted path as a demo kill switch.
  useLiveLlm: readBool(process.env.USE_LIVE_LLM, true),
  llmModel: process.env.LLM_MODEL ?? "openai/gpt-5-nano",
};

export const demoIds = {
  patientFhirId: process.env.DEMO_PATIENT_FHIR_ID ?? "",
  encounterFhirId: process.env.DEMO_ENCOUNTER_FHIR_ID ?? "",
  appointmentFhirId: process.env.DEMO_APPOINTMENT_FHIR_ID ?? "",
};
