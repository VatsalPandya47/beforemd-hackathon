// Shared domain types for BeforeMD. Mirrors doc section 6 (API contracts) and section 7 (agent schema).

export type ToolResult<T> = {
  ok: boolean;
  source: "live" | "cache" | "fixture";
  data?: T;
  error?: string;
  latencyMs: number;
};

export type SessionMode = "live" | "replay";

export type DemoSession = {
  id: string;
  patientFhirId: string;
  encounterFhirId: string | null;
  status: string;
  mode: SessionMode;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type TranscriptSpeaker = "patient" | "agent";

export type TranscriptEvent = {
  id: number;
  sessionId: string;
  speaker: TranscriptSpeaker;
  text: string;
  isFinal: boolean;
  sequenceNo: number;
  createdAt: string;
};

export type AgentEventType =
  | "tool_started"
  | "tool_completed"
  | "insight"
  | "safety_flag";

export type AgentEvent = {
  id: number;
  sessionId: string;
  eventType: AgentEventType;
  toolName: string | null;
  title: string;
  payload: Record<string, unknown>;
  sequenceNo: number;
  createdAt: string;
};

// --- Medplum / clinical context ---

export type MedicationSummary = {
  fhirId: string;
  name: string;
  status: string;
  startDate: string | null;
};

export type ConditionSummary = {
  fhirId: string;
  name: string;
  onsetDate: string | null;
};

export type AllergySummary = {
  fhirId: string;
  substance: string;
  reaction: string | null;
};

export type PriorDocumentSummary = {
  fhirId: string;
  title: string;
  date: string | null;
  excerpt: string | null;
};

export type PatientContext = {
  patientFhirId: string;
  name: string;
  age: number;
  medications: MedicationSummary[];
  conditions: ConditionSummary[];
  allergies: AllergySummary[];
  priorDocuments: PriorDocumentSummary[];
};

export type DraftWriteInput = {
  sessionId: string;
  patientFhirId: string;
  encounterFhirId: string | null;
  questionnaireResponse: Record<string, unknown>;
  clinicalImpressionNote: string;
};

export type FhirWriteResult = {
  taskFhirId: string;
  questionnaireResponseFhirId: string;
  clinicalImpressionFhirId: string;
};

// --- Moss (context retrieval) ---

export type RetrievedContext = {
  sourceId: string;
  sourceType: string;
  title: string;
  snippet: string;
  relevance: number;
};

// --- Stedi (eligibility) ---

export type EligibilityInput = {
  patientFhirId: string;
  payerId: string;
  memberId: string;
  serviceType: string;
};

export type CoverageSummary = {
  active: boolean;
  planName: string;
  network: "in-network" | "out-of-network" | "unknown";
  copayEstimateCents: number | null;
  deductibleRemainingCents: number | null;
};

// --- Clinical draft (agent output) ---
// Kept structurally identical to ClinicalDraftSchema in lib/agent/schemas.ts.

export type TimelineEntry = {
  date: string;
  label: string;
  sourceType: string;
  sourceId: string;
};

export type SafetyFlagStatus = "present" | "absent" | "unknown";

export type SafetyFlag = {
  name: string;
  status: SafetyFlagStatus;
};

export type KeyConnection = {
  statement: string;
  confidence: "low" | "moderate" | "high";
  evidenceSourceIds: string[];
} | null;

export type ClinicalDraft = {
  sessionId: string;
  chiefConcern: string;
  historyOfPresentIllness: {
    onset: string | null;
    location: string | null;
    duration: string | null;
    characteristics: string[];
    aggravatingFactors: string[];
    relievingFactors: string[];
    associatedSymptoms: string[];
  };
  timeline: TimelineEntry[];
  safetyFlags: SafetyFlag[];
  keyConnection: KeyConnection;
  unresolvedQuestions: string[];
  clinicianReviewNotes: string[];
  patientFriendlySummary: string;
  coverageSummary: CoverageSummary | null;
  clinicianStatus: "draft" | "approved";
};

// --- Agent state machine ---

export type AgentState =
  | "CONSENT"
  | "LOAD_HISTORY"
  | "OPENING_QUESTION"
  | "IDENTIFY_GAP"
  | "ASK_ADAPTIVE_QUESTION"
  | "SAFETY_SCREEN"
  | "RETRIEVE_SUPPORTING_CONTEXT"
  | "BUILD_TIMELINE"
  | "CHECK_ELIGIBILITY"
  | "GENERATE_DRAFT"
  | "PATIENT_CONFIRMATION"
  | "CLINICIAN_REVIEW_READY";

export type AgentTurnResult = {
  reply: string;
  nextState: AgentState;
  toolEvents: AgentEvent[];
  draftPatch: Partial<ClinicalDraft> | null;
};
