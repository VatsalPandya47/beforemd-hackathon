// Shared domain types for BeforeMD. Mirrors doc section 6 (API contracts) and section 7 (agent schema).

export type ToolSource = "live" | "cache" | "fixture";

export type ToolResult<T> = {
  ok: boolean;
  source: ToolSource;
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

// The clinician brief renders these ids as proof of what approval wrote to the
// chart, so `source` travels with them: writeDraft has a fixture branch that
// returns DEMO_* ids without contacting Medplum at all (medplum.ts), and a
// provenance claim the UI cannot qualify is worse than no claim.
export type ApproveResponse = FhirWriteResult & {
  status: "approved";
  source: ToolSource;
};

export type ApproveErrorResponse = {
  error: string;
  source: ToolSource;
};

// --- Patient portal ---
// What the patient sees of their own record. Everything here is derived from
// Medplum or from this app's own session rows — nothing is stored twice.

export type CareTeamMember = {
  fhirId: string;
  name: string;
  specialty: string | null;
};

export type VisitSummary = {
  fhirId: string;
  // Which FHIR resource this row came from, so the portal can label it.
  resourceType: "Appointment" | "Encounter";
  description: string;
  date: string | null;
  status: string;
  practitionerFhirId: string | null;
  practitionerName: string | null;
};

export type VisitHistory = {
  upcoming: VisitSummary[];
  past: VisitSummary[];
  // Derived from the practitioners referenced by the visits above, not from a
  // Practitioner search — "doctors I have seen" means exactly that.
  careTeam: CareTeamMember[];
};

export type PatientRequestType = "question" | "refill" | "appointment" | "records";

export type PatientRequest = {
  fhirId: string;
  type: PatientRequestType | "unknown";
  message: string;
  status: string;
  authoredOn: string | null;
  // MedicationRequest/<id> for a refill, Appointment/<id> for a reschedule.
  focusReference: string | null;
};

export type PatientRequestInput = {
  patientFhirId: string;
  type: PatientRequestType;
  message: string;
  focusReference?: string;
};

// One past pre-visit conversation, with the transcript inline. Bundled into the
// overview rather than fetched per session: a demo has a handful of sessions,
// and one payload beats a request per expanded row.
export type PatientConversation = {
  sessionId: string;
  startedAt: string | null;
  status: string;
  mode: SessionMode;
  chiefConcern: string | null;
  transcript: TranscriptEvent[];
};

// `?section=health` on /api/patient/overview returns this same shape with
// `visits`, `conversations` and `requests` empty — not fetched, rather than
// none. Only `patient` and `source` are meaningful there. Callers that need to
// tell the two apart should request `section=all` (the default).
export type PatientOverview = {
  patient: PatientContext;
  visits: VisitHistory;
  conversations: PatientConversation[];
  requests: PatientRequest[];
  coverage: CoverageSummary | null;
  // Same convention as the sponsor adapters. One field rather than one per
  // section: all three reads are gated on the same flag and the screen shows a
  // single badge, so "live" here means every read was live.
  source: ToolSource;
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
  // Stedi calls this tradingPartnerServiceId — the payer's clearinghouse id.
  payerId: string;
  memberId: string;
  serviceType: string;
  // The 271 is matched on subscriber name as well as member id. Optional so
  // callers can rely on the adapter's synthetic demo defaults.
  subscriberFirstName?: string;
  subscriberLastName?: string;
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
