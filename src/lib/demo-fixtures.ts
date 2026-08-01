import type {
  ClinicalDraft,
  CoverageSummary,
  PatientContext,
  RetrievedContext,
} from "@/types";

// Synthetic-only demo patient (doc section 2). Real FHIR IDs get filled in
// once Kashish seeds Medplum — see docs/demo-fixtures.md checked in alongside
// this file once resource IDs exist.
export const DEMO_PATIENT_NAME = "Maya Thompson";

export const demoPatientContext: PatientContext = {
  patientFhirId: "DEMO_PATIENT_FHIR_ID",
  name: DEMO_PATIENT_NAME,
  age: 29,
  medications: [
    {
      fhirId: "DEMO_MEDICATION_LAMOTRIGINE",
      name: "Lamotrigine",
      status: "active",
      startDate: "2026-06-26",
    },
  ],
  conditions: [
    {
      fhirId: "DEMO_CONDITION_RASH",
      name: "Recurring dermatitis / rash",
      onsetDate: "2026-07-07",
    },
  ],
  // Deliberately environmental, not a drug allergy — a drug allergy already on
  // the chart would make the agent's medication-timing discovery look pre-known.
  allergies: [
    {
      fhirId: "DEMO_ALLERGY_POLLEN",
      substance: "Pollen (seasonal)",
      reaction: "Seasonal rhinitis, no rash",
    },
  ],
  priorDocuments: [
    {
      fhirId: "DEMO_DOCUMENT_PRIOR_NOTE",
      title: "Dermatology visit note - first rash episode",
      date: "2026-07-10",
      excerpt:
        "Patient presented with pruritic rash on arms and torso. Improved with topical steroid.",
    },
  ],
};

export const demoRetrievedContext: RetrievedContext[] = [
  {
    sourceId: "DEMO_DOCUMENT_PRIOR_NOTE",
    sourceType: "DocumentReference",
    title: "Dermatology visit note - first rash episode",
    snippet: "Topical steroid improved symptoms temporarily.",
    relevance: 0.92,
  },
];

export const demoCoverageSummary: CoverageSummary = {
  active: true,
  planName: "Synthetic PPO Plan",
  network: "in-network",
  copayEstimateCents: 3000,
  deductibleRemainingCents: 0,
};

export const demoClinicalDraft: ClinicalDraft = {
  sessionId: "DEMO_SESSION",
  chiefConcern: "Recurring itchy rash on arms and torso",
  historyOfPresentIllness: {
    onset: "About 11 days after starting lamotrigine",
    location: "Arms and torso",
    duration: "Recurring over several weeks",
    characteristics: ["itchy", "recurring"],
    aggravatingFactors: ["restarting lamotrigine"],
    relievingFactors: ["topical steroid"],
    associatedSymptoms: [],
  },
  timeline: [
    {
      date: "2026-06-26",
      label: "Lamotrigine started",
      sourceType: "MedicationRequest",
      sourceId: "DEMO_MEDICATION_LAMOTRIGINE",
    },
    {
      date: "2026-07-07",
      label: "Rash onset (11 days after medication start)",
      sourceType: "Condition",
      sourceId: "DEMO_CONDITION_RASH",
    },
    {
      date: "2026-07-10",
      label: "Topical steroid improved symptoms",
      sourceType: "DocumentReference",
      sourceId: "DEMO_DOCUMENT_PRIOR_NOTE",
    },
  ],
  safetyFlags: [
    { name: "breathing difficulty", status: "absent" },
    { name: "facial or mouth swelling", status: "absent" },
    { name: "fever", status: "absent" },
    { name: "mucosal sores", status: "absent" },
    { name: "blistering", status: "absent" },
    { name: "rapid spread", status: "absent" },
    { name: "severe pain", status: "absent" },
  ],
  keyConnection: {
    statement:
      "The symptoms first appeared 11 days after the medication was started and returned after it was resumed.",
    confidence: "moderate",
    evidenceSourceIds: ["DEMO_MEDICATION_LAMOTRIGINE", "DEMO_CONDITION_RASH"],
  },
  unresolvedQuestions: [
    "Has the patient tried any new topical products in the same window?",
  ],
  clinicianReviewNotes: [
    "Patient-reported timing suggests a possible medication-associated rash; clinician confirmation required.",
  ],
  patientFriendlySummary:
    "We documented your rash history and its timing relative to your medication. Your clinician will review this before your visit.",
  coverageSummary: demoCoverageSummary,
  clinicianStatus: "draft",
};
