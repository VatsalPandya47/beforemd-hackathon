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
  allergies: [],
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

// --- Replay fallback (issue #18, fallback ladder) ---

export type DemoReplayTool = {
  toolName: string;
  /** Title while running, then the title once it lands — same pair the orchestrator emits. */
  startedTitle: string;
  completedTitle: string;
};

export type DemoReplayTurn = {
  patient: string;
  agent: string;
  tools: DemoReplayTool[];
};

/**
 * One committed run of the intake conversation, used by `/api/demo/replay`
 * when Supabase has nothing to replay (or cannot be reached). Ordered exactly
 * as a live run commits it: patient utterance, then that turn's tool events,
 * then the agent's reply.
 *
 * The agent lines here are the **locked wording from `docs/demo-script.md`**,
 * not the placeholder copy `orchestrator.ts` returns today. That is deliberate:
 * this is the rehearsed fallback shown if the live path dies on stage, and the
 * live placeholders currently ask "Did the rash begin before or after you
 * started lamotrigine?" three times (OPENING_QUESTION, IDENTIFY_GAP and
 * ASK_ADAPTIVE_QUESTION all return the same string). Once #11 wires the real
 * LLM the two converge; until then the fixture is the one that matches what the
 * team rehearses and pitches.
 *
 * Tool names and titles DO mirror `orchestrator.ts` exactly, so the activity
 * rail looks identical whether the run was live or replayed.
 */
export const demoReplayTurns: DemoReplayTurn[] = [
  {
    patient: "Hello.",
    agent:
      "Hi Maya. I'm BeforeMD, the pre-visit assistant for your care team. I'll ask a few questions and prepare a draft for your clinician to review. Is that okay?",
    tools: [],
  },
  {
    patient: "Yes.",
    agent: "What would you most like your doctor to understand today?",
    tools: [
      {
        toolName: "get_patient_context",
        startedTitle: "Reviewing medication and visit history",
        completedTitle: "Reviewed medication and visit history",
      },
    ],
  },
  {
    patient:
      "This rash keeps coming back. I changed medication recently, but I don't know if that is connected.",
    agent:
      "I can see lamotrigine was started five weeks ago. Did the rash begin before or after you started it?",
    tools: [],
  },
  {
    patient: "After. Maybe a week and a half later.",
    agent: "Did it improve when you stopped or paused the medication?",
    tools: [],
  },
  {
    patient: "It got better with the cream, then came back after I started the medication again.",
    agent:
      "Are you having trouble breathing, swelling of the face or mouth, fever, or sores in your mouth?",
    tools: [],
  },
  {
    patient: "No.",
    agent: "Thank you. I'll flag the timing and document your answers.",
    tools: [
      {
        toolName: "check_safety_red_flags",
        startedTitle: "Checking for urgent warning signs",
        completedTitle: "Checked for urgent warning signs",
      },
    ],
  },
  {
    patient: "Okay.",
    agent: "I'll also check your coverage for the visit.",
    tools: [
      {
        toolName: "retrieve_relevant_context",
        startedTitle: "Finding the most relevant prior context",
        completedTitle: "Found relevant prior context",
      },
    ],
  },
  {
    patient: "That makes sense.",
    agent: "I found a timing connection worth flagging for your clinician.",
    tools: [
      {
        toolName: "build_timeline",
        startedTitle: "Connecting symptoms to the longitudinal timeline",
        completedTitle: "Connected symptoms to the longitudinal timeline",
      },
    ],
  },
  {
    patient: "Thank you.",
    agent: "Your coverage looks active for this visit.",
    tools: [
      {
        toolName: "check_eligibility",
        startedTitle: "Checking insurance benefits",
        completedTitle: "Checked insurance benefits",
      },
    ],
  },
  {
    patient: "Good to know.",
    agent: "I've prepared a draft for your clinician to review.",
    tools: [
      {
        toolName: "create_clinician_draft",
        startedTitle: "Preparing the clinician review",
        completedTitle: "Prepared the clinician review",
      },
    ],
  },
  {
    patient: "Okay, thank you.",
    agent:
      "Your clinician will review this draft before your visit. No diagnosis or treatment decision has been made.",
    tools: [],
  },
];
