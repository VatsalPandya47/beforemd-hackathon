import { MedplumClient } from "@medplum/core";
import { flags } from "@/lib/flags";
import {
  demoPatientContext,
  demoPatientRequests,
  demoVisitHistory,
} from "@/lib/demo-fixtures";
import type {
  AllergyIntolerance,
  Appointment,
  Claim,
  Condition,
  DocumentReference,
  Encounter,
  MedicationRequest,
  Practitioner,
  Task,
} from "@medplum/fhirtypes";
import type {
  CostEstimate,
  DraftWriteInput,
  FhirWriteResult,
  PatientContext,
  PatientRequest,
  PatientRequestInput,
  PatientRequestType,
  SavedCostEstimate,
  ToolResult,
  VisitHistory,
  VisitSummary,
} from "@/types";

// Provider of record on the predetermination Claim. Not a real NPI-backed
// organisation — same synthetic posture as the rest of the demo.
const PROVIDER_DISPLAY = "BeforeMD Demo Practice";

let client: MedplumClient | null = null;

function getClient(): MedplumClient {
  if (!client) {
    client = new MedplumClient({ baseUrl: process.env.MEDPLUM_BASE_URL });
  }
  return client;
}

// startClientLogin does a full OAuth round trip on every call — measured at
// ~200ms warm, and it does NOT short-circuit on a valid unexpired token. Every
// read goes through withFixture -> ensureAuth, and the patient portal runs three
// reads in Promise.all, so without memoising this each portal load spends ~500ms
// re-fetching a token it already has.
//
// ponytail: fixed window rather than decoding the token's own expiry. Medplum
// access tokens outlive this comfortably, re-login is cheap, and a token that
// expires early surfaces as an ordinary request failure the fixture ladder
// already handles.
const AUTH_TTL_MS = 5 * 60_000;

let authPromise: Promise<void> | null = null;
let authExpiresAt = 0;

function resetAuth(): void {
  authPromise = null;
  authExpiresAt = 0;
}

async function ensureAuth(): Promise<void> {
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Medplum client credentials are not configured");
  }

  // Concurrent callers share the in-flight login rather than racing three of them.
  if (authPromise && Date.now() < authExpiresAt) return authPromise;

  authExpiresAt = Date.now() + AUTH_TTL_MS;
  authPromise = getClient()
    .startClientLogin(clientId, clientSecret)
    .then(() => undefined);

  // A failed login must not stay cached, or every later read inherits it.
  authPromise.catch(resetAuth);

  return authPromise;
}

// The evidence chip behind each timeline point shows this snippet, so it has to
// survive the live path too — not just the fixture. Seeded as an inline base64
// text/plain attachment by scripts/seed-medplum.mjs.
function readInlineText(doc: DocumentReference): string | null {
  const attachment = doc.content?.find((c) => c.attachment?.data)?.attachment;
  if (!attachment?.data) return null;
  return Buffer.from(attachment.data, "base64").toString("utf-8").trim() || null;
}

/**
 * The fixture ladder every Medplum read follows (doc section 10): serve the
 * fixture when live Medplum is switched off, otherwise authenticate and run the
 * read, and on failure fall back to the fixture unless ALLOW_FIXTURE_FALLBACK
 * says to surface the error instead.
 */
async function withFixture<T>(
  fixture: T,
  run: () => Promise<T>
): Promise<ToolResult<T>> {
  const started = performance.now();
  const latencyMs = () => performance.now() - started;

  if (!flags.useLiveMedplum) {
    return { ok: true, source: "fixture", data: fixture, latencyMs: latencyMs() };
  }

  try {
    await ensureAuth();
    return { ok: true, source: "live", data: await run(), latencyMs: latencyMs() };
  } catch (error) {
    // Drop the memoised token on any live failure. Before it was memoised, every
    // read re-authenticated and so self-healed from a token that died inside the
    // window; the fixture ladder below rescues the request, not the stale cache,
    // so without this one bad token means every read fails until the window
    // rolls. Costs one extra login after a failed read.
    resetAuth();
    if (!flags.allowFixtureFallback) {
      return {
        ok: false,
        source: "live",
        error: error instanceof Error ? error.message : "Medplum request failed",
        latencyMs: latencyMs(),
      };
    }
    return { ok: true, source: "fixture", data: fixture, latencyMs: latencyMs() };
  }
}

// Medplum is the clinical source of truth; Supabase never duplicates the full
// FHIR record (see doc section 3 architecture boundary).
export async function getPatientContext(
  patientId: string
): Promise<ToolResult<PatientContext>> {
  return withFixture({ ...demoPatientContext, patientFhirId: patientId }, async () => {
    const medplum = getClient();

    const [patient, medicationRequests, conditions, allergies, documents] =
      await Promise.all([
        medplum.readResource("Patient", patientId),
        medplum.searchResources("MedicationRequest", { subject: patientId }),
        medplum.searchResources("Condition", { subject: patientId }),
        medplum.searchResources("AllergyIntolerance", { patient: patientId }),
        medplum.searchResources("DocumentReference", { subject: patientId }),
      ]);

    return {
      patientFhirId: patientId,
      name: patient.name?.[0]?.text ?? "Unknown patient",
      age: patient.birthDate
        ? new Date().getFullYear() - new Date(patient.birthDate).getFullYear()
        : 0,
      medications: medicationRequests.map((m: MedicationRequest) => ({
        fhirId: m.id ?? "",
        name: m.medicationCodeableConcept?.text ?? "Unknown medication",
        status: m.status ?? "unknown",
        startDate: m.authoredOn ?? null,
      })),
      conditions: conditions.map((c: Condition) => ({
        fhirId: c.id ?? "",
        name: c.code?.text ?? "Unknown condition",
        onsetDate:
          c.onsetDateTime ?? (typeof c.onsetPeriod?.start === "string" ? c.onsetPeriod.start : null),
      })),
      allergies: allergies.map((a: AllergyIntolerance) => ({
        fhirId: a.id ?? "",
        substance: a.code?.text ?? "Unknown substance",
        reaction: a.reaction?.[0]?.description ?? null,
      })),
      priorDocuments: documents.map((d: DocumentReference) => ({
        fhirId: d.id ?? "",
        title: d.description ?? d.type?.text ?? "Untitled document",
        date: d.date ?? null,
        excerpt: readInlineText(d),
      })),
    };
  });
}

// --- Patient portal ----------------------------------------------------------

// Same shape getPatientContext uses for the Patient's name.
function practitionerDisplayName(practitioner: Practitioner): string {
  return practitioner.name?.[0]?.text ?? "Unknown clinician";
}

// Appointment hangs the actor off participant[].actor, Encounter off
// participant[].individual. Both lists also contain non-practitioners — the
// patient is a participant on their own appointment — hence the prefix filter.
function practitionerIdsFrom(resource: Appointment | Encounter): string[] {
  const ids: string[] = [];
  for (const participant of resource.participant ?? []) {
    const reference =
      ("actor" in participant ? participant.actor?.reference : undefined) ??
      ("individual" in participant ? participant.individual?.reference : undefined);
    if (reference?.startsWith("Practitioner/")) {
      ids.push(reference.slice("Practitioner/".length));
    }
  }
  return ids;
}

// Undated sorts to epoch 0, which puts it last in the descending `past` list
// and cannot arise in `upcoming` — that list is filtered on having a date.
const visitTime = (visit: VisitSummary) => (visit.date ? Date.parse(visit.date) : 0);

// A cancelled appointment belongs in neither list. Out of Upcoming because it
// would also reach the reschedule picker, letting the patient ask to move a visit
// that no longer exists; out of Past because Past sorts date-descending, so a
// cancelled future appointment would head the list of visits that happened.
const DEAD_STATUSES = new Set(["cancelled", "noshow", "entered-in-error"]);

/**
 * Sorts a patient's appointments and encounters into upcoming and past. Pure and
 * exported for the test — this bucketing has produced two disappearing-visit
 * bugs, so it gets a check rather than only being exercised through a live read.
 *
 * Takes every encounter and applies the finished filter itself, rather than
 * being handed a pre-filtered list: the rows and the de-dup set below must come
 * from the same encounters, and that only holds if one place decides which ones.
 */
export function splitVisits(
  appointmentRows: VisitSummary[],
  encounters: Encounter[],
  toRow: (encounter: Encounter) => VisitSummary,
  now: number
): Pick<VisitHistory, "upcoming" | "past"> {
  const isUpcoming = (visit: VisitSummary) =>
    visit.date !== null && Date.parse(visit.date) > now;
  const isDead = (visit: VisitSummary) => DEAD_STATUSES.has(visit.status);

  // Only finished encounters are a visit that happened. The planned pre-visit
  // intake Encounter is this app's own artifact, not somewhere the patient went,
  // so it appears in neither list — its practitioner still joins the care team.
  const finished = encounters.filter((encounter) => encounter.status === "finished");
  const encounterRows = finished.map(toRow);

  // A completed visit exists as both an Appointment and the Encounter it
  // produced, so a real chart would list it twice. Encounter.appointment is the
  // link between them; the Encounter wins because it carries what actually
  // happened.
  //
  // Built from `finished` — the encounters that actually produce rows. The
  // seeded planned intake Encounter also references the upcoming appointment, so
  // taking every encounter would suppress that appointment from Past the moment
  // it stops being upcoming, with no Encounter row replacing it: the visit would
  // vanish from the portal entirely.
  const encounterAppointmentIds = new Set(
    finished.flatMap((e) =>
      (e.appointment ?? [])
        .map((ref) => ref.reference?.split("/")[1])
        .filter((id): id is string => Boolean(id))
    )
  );

  return {
    upcoming: appointmentRows
      .filter((v) => isUpcoming(v) && !isDead(v))
      .sort((a, b) => visitTime(a) - visitTime(b)),
    past: [
      ...appointmentRows.filter(
        (v) => !isUpcoming(v) && !isDead(v) && !encounterAppointmentIds.has(v.fhirId)
      ),
      ...encounterRows,
    ].sort((a, b) => visitTime(b) - visitTime(a)),
  };
}

/**
 * The patient's visits and the clinicians on them. Deliberately separate from
 * `getPatientContext`, which runs on every intake turn — the agent does not
 * need appointments or practitioners, and this would make its hot path three
 * searches heavier.
 */
export async function getVisitHistory(
  patientId: string
): Promise<ToolResult<VisitHistory>> {
  return withFixture(demoVisitHistory, async () => {
    const medplum = getClient();

    const [appointments, encounters] = await Promise.all([
      medplum.searchResources("Appointment", { patient: patientId }),
      medplum.searchResources("Encounter", { subject: patientId }),
    ]);

    const practitionerIds = [
      ...new Set([
        ...appointments.flatMap(practitionerIdsFrom),
        ...encounters.flatMap(practitionerIdsFrom),
      ]),
    ];

    // One search instead of a read per id. Skipped when nothing references a
    // practitioner: `_id=` with an empty value would match every Practitioner
    // in the project rather than none.
    const practitioners = practitionerIds.length
      ? await medplum.searchResources("Practitioner", { _id: practitionerIds.join(",") })
      : [];
    const byId = new Map(practitioners.map((p) => [p.id ?? "", p]));

    const nameFor = (id: string | null) => {
      const practitioner = id ? byId.get(id) : undefined;
      return practitioner ? practitionerDisplayName(practitioner) : null;
    };

    const appointmentRows: VisitSummary[] = appointments.map((appointment) => {
      const practitionerFhirId = practitionerIdsFrom(appointment)[0] ?? null;
      return {
        fhirId: appointment.id ?? "",
        resourceType: "Appointment",
        description:
          appointment.description ?? appointment.serviceType?.[0]?.text ?? "Appointment",
        date: appointment.start ?? null,
        status: appointment.status ?? "unknown",
        practitionerFhirId,
        practitionerName: nameFor(practitionerFhirId),
      };
    });

    const encounterRow = (encounter: Encounter): VisitSummary => {
      const practitionerFhirId = practitionerIdsFrom(encounter)[0] ?? null;
      return {
        fhirId: encounter.id ?? "",
        resourceType: "Encounter",
        description: encounter.type?.[0]?.text ?? "Visit",
        date: encounter.period?.start ?? null,
        status: encounter.status ?? "unknown",
        practitionerFhirId,
        practitionerName: nameFor(practitionerFhirId),
      };
    };

    return {
      ...splitVisits(appointmentRows, encounters, encounterRow, Date.now()),
      careTeam: practitioners.map((practitioner) => ({
        fhirId: practitioner.id ?? "",
        name: practitionerDisplayName(practitioner),
        specialty: practitioner.qualification?.[0]?.code?.text ?? null,
      })),
    };
  });
}

const REQUEST_TYPE_SYSTEM = "urn:beforemd:request-type";

const REQUEST_TYPE_LABELS: Record<PatientRequestType, string> = {
  question: "Question for the care team",
  refill: "Medication refill request",
  appointment: "Appointment request",
  records: "Records request",
};

// hasOwn, not `in`: `in` walks the prototype chain, so a Task coded
// "constructor" or "toString" would narrow to PatientRequestType and lie to
// every consumer downstream.
function isRequestType(value: string | undefined): value is PatientRequestType {
  return value !== undefined && Object.hasOwn(REQUEST_TYPE_LABELS, value);
}

function toPatientRequest(task: Task): PatientRequest {
  const code = task.code?.coding?.find((c) => c.system === REQUEST_TYPE_SYSTEM)?.code;
  return {
    fhirId: task.id ?? "",
    type: isRequestType(code) ? code : "unknown",
    message: task.description ?? "",
    status: task.status ?? "unknown",
    authoredOn: task.authoredOn ?? null,
    focusReference: task.focus?.reference ?? null,
  };
}

export async function listPatientRequests(
  patientId: string
): Promise<ToolResult<PatientRequest[]>> {
  return withFixture(demoPatientRequests, async () => {
    // Searching on `requester` is what separates a patient's own requests from
    // the clinician-review Tasks writeDraft creates, which set `for` but never
    // `requester`. Searching on `for` would mix the two.
    //
    // _sort and _count matter: searchResources returns a single page (Medplum
    // defaults to 20) and these Tasks are never cleaned up, so they accumulate
    // across demo runs. Sorting client-side only would order whichever arbitrary
    // page came back — past 20 requests the patient would file one, be told its
    // Task id, and not find it in the list directly below.
    const tasks = await getClient().searchResources("Task", {
      requester: `Patient/${patientId}`,
      _sort: "-authored-on",
      _count: "50",
    });

    // Server-sorted already; this only settles rows Medplum left undated, which
    // go last — same rule as visitTime.
    const authored = (request: PatientRequest) =>
      request.authoredOn ? Date.parse(request.authoredOn) : 0;

    return tasks.map(toPatientRequest).sort((a, b) => authored(b) - authored(a));
  });
}

/**
 * Files a patient request as a FHIR Task.
 *
 * No fixture branch that hands back an invented id, for the same reason
 * `writeDraft` has none: a patient who is told their request was filed when
 * nothing was written is worse off than one who sees an error.
 */
export async function createPatientRequest(
  input: PatientRequestInput
): Promise<ToolResult<PatientRequest>> {
  const started = performance.now();

  if (!flags.useLiveMedplum) {
    return {
      ok: false,
      source: "fixture",
      error: "Medplum is running on its fixture path, so this request was not filed.",
      latencyMs: performance.now() - started,
    };
  }

  try {
    await ensureAuth();
    const patientReference = { reference: `Patient/${input.patientFhirId}` };

    const task = await getClient().createResource<Task>({
      resourceType: "Task",
      status: "requested",
      // "proposal", not the "order" writeDraft uses for the clinician review
      // task: this is the patient asking for something, not the practice
      // instructing someone to do it.
      intent: "proposal",
      priority: "routine",
      code: {
        coding: [{ system: REQUEST_TYPE_SYSTEM, code: input.type }],
        text: REQUEST_TYPE_LABELS[input.type],
      },
      for: patientReference,
      requester: patientReference,
      authoredOn: new Date().toISOString(),
      description: input.message,
      focus: input.focusReference ? { reference: input.focusReference } : undefined,
    });

    return {
      ok: true,
      source: "live",
      data: toPatientRequest(task),
      latencyMs: performance.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      source: "live",
      error: error instanceof Error ? error.message : "Medplum request write failed",
      latencyMs: performance.now() - started,
    };
  }
}

// --- Cost estimate write-back ------------------------------------------------

const COST_ESTIMATE_SYSTEM = "urn:beforemd:cost-estimate";

/**
 * Save an accepted cost estimate to the chart as a `Claim` with
 * `use: "predetermination"` — R4's resource for "what would this cost before it
 * happens", which is exactly what this is. A distinct resource type from Task,
 * so it can never surface in the patient's request list (listPatientRequests
 * searches `Task?requester=`).
 *
 * No fixture branch, same as createPatientRequest: on the fixture path this
 * refuses rather than handing the patient an id that does not exist.
 */
export async function saveCostEstimate(input: {
  patientFhirId: string;
  estimate: CostEstimate;
}): Promise<ToolResult<SavedCostEstimate>> {
  const started = performance.now();

  if (!flags.useLiveMedplum) {
    return {
      ok: false,
      source: "fixture",
      error: "Medplum is running on its fixture path, so this estimate was not saved.",
      latencyMs: performance.now() - started,
    };
  }

  try {
    await ensureAuth();
    const { estimate } = input;
    const patientReference = { reference: `Patient/${input.patientFhirId}` };
    const money = (cents: number) => ({ value: cents / 100, currency: "USD" as const });

    const claim = await getClient().createResource<Claim>({
      resourceType: "Claim",
      status: "active",
      type: { coding: [{ code: "professional" }] },
      // The whole point: this is a cost prediction, not a bill for care given.
      use: "predetermination",
      patient: patientReference,
      created: new Date().toISOString(),
      // Required by R4 but not meaningful for a patient-facing estimate; the
      // practice is the provider of record.
      provider: { display: PROVIDER_DISPLAY },
      priority: { coding: [{ code: "normal" }] },
      insurance: [
        {
          sequence: 1,
          focal: true,
          coverage: { display: estimate.planName },
        },
      ],
      item: [
        {
          sequence: 1,
          productOrService: { text: estimate.serviceDescription },
          net: money(estimate.allowedAmountCents),
          ...(estimate.appointmentFhirId
            ? { encounter: [{ reference: `Appointment/${estimate.appointmentFhirId}` }] }
            : {}),
        },
      ],
      total: money(estimate.allowedAmountCents),
      // Claim has no field for "what the patient will owe" — that is
      // ExplanationOfBenefit, which only exists after adjudication. The
      // breakdown rides here so the chart carries what the patient was actually
      // shown, not just the gross amount.
      supportingInfo: [
        {
          sequence: 1,
          category: { coding: [{ system: COST_ESTIMATE_SYSTEM, code: "patient-responsibility" }] },
          valueString: JSON.stringify({
            patientPaysCents: estimate.patientPaysCents,
            insurancePaysCents: estimate.insurancePaysCents,
            deductibleAppliedCents: estimate.deductibleAppliedCents,
            coinsuranceCents: estimate.coinsuranceCents,
            copayCents: estimate.copayCents,
            lowCents: estimate.lowCents,
            highCents: estimate.highCents,
            confidence: estimate.confidence,
            rateBasis: estimate.rateBasis,
          }),
        },
      ],
    });

    return {
      ok: true,
      source: "live",
      data: { claimFhirId: claim.id ?? "", patientPaysCents: estimate.patientPaysCents },
      latencyMs: performance.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      source: "live",
      error: error instanceof Error ? error.message : "Medplum estimate write failed",
      latencyMs: performance.now() - started,
    };
  }
}

export async function writeDraft(
  input: DraftWriteInput
): Promise<ToolResult<FhirWriteResult>> {
  const started = performance.now();

  if (!flags.useLiveMedplum) {
    return {
      ok: true,
      source: "fixture",
      data: {
        taskFhirId: "DEMO_TASK",
        questionnaireResponseFhirId: "DEMO_QUESTIONNAIRE_RESPONSE",
        clinicalImpressionFhirId: "DEMO_CLINICAL_IMPRESSION",
      },
      latencyMs: performance.now() - started,
    };
  }

  try {
    await ensureAuth();
    const medplum = getClient();

    const questionnaireResponse = await medplum.createResource({
      resourceType: "QuestionnaireResponse",
      status: "completed",
      subject: { reference: `Patient/${input.patientFhirId}` },
      encounter: input.encounterFhirId
        ? { reference: `Encounter/${input.encounterFhirId}` }
        : undefined,
      item: [],
      ...input.questionnaireResponse,
    });

    const clinicalImpression = await medplum.createResource({
      resourceType: "ClinicalImpression",
      status: "in-progress",
      subject: { reference: `Patient/${input.patientFhirId}` },
      note: [{ text: `DRAFT (unverified): ${input.clinicalImpressionNote}` }],
    });

    const task = await medplum.createResource({
      resourceType: "Task",
      status: "requested",
      intent: "order",
      description: "Review BeforeMD pre-visit draft",
      for: { reference: `Patient/${input.patientFhirId}` },
      focus: { reference: `ClinicalImpression/${clinicalImpression.id}` },
    });

    return {
      ok: true,
      source: "live",
      data: {
        taskFhirId: task.id ?? "",
        questionnaireResponseFhirId: questionnaireResponse.id ?? "",
        clinicalImpressionFhirId: clinicalImpression.id ?? "",
      },
      latencyMs: performance.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      source: "live",
      error: error instanceof Error ? error.message : "Medplum write failed",
      latencyMs: performance.now() - started,
    };
  }
}
