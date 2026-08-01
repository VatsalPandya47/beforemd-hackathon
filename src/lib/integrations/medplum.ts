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
  Condition,
  DocumentReference,
  Encounter,
  MedicationRequest,
  Practitioner,
  Task,
} from "@medplum/fhirtypes";
import type {
  DraftWriteInput,
  FhirWriteResult,
  PatientContext,
  PatientRequest,
  PatientRequestInput,
  PatientRequestType,
  ToolResult,
  VisitHistory,
  VisitSummary,
} from "@/types";

let client: MedplumClient | null = null;

function getClient(): MedplumClient {
  if (!client) {
    client = new MedplumClient({ baseUrl: process.env.MEDPLUM_BASE_URL });
  }
  return client;
}

async function ensureAuth(): Promise<void> {
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Medplum client credentials are not configured");
  }
  await getClient().startClientLogin(clientId, clientSecret);
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

    // Only finished encounters are a visit that happened. The planned pre-visit
    // intake Encounter is this app's own artifact, not somewhere the patient
    // went, so it appears in neither list — its practitioner still joins the
    // care team below.
    const encounterRows: VisitSummary[] = encounters
      .filter((encounter) => encounter.status === "finished")
      .map((encounter) => {
        const practitionerFhirId = practitionerIdsFrom(encounter)[0] ?? null;
        return {
          fhirId: encounter.id ?? "",
          resourceType: "Encounter" as const,
          description: encounter.type?.[0]?.text ?? "Visit",
          date: encounter.period?.start ?? null,
          status: encounter.status ?? "unknown",
          practitionerFhirId,
          practitionerName: nameFor(practitionerFhirId),
        };
      });

    const now = Date.now();
    const isUpcoming = (visit: VisitSummary) =>
      visit.date !== null && Date.parse(visit.date) > now;

    return {
      upcoming: appointmentRows
        .filter(isUpcoming)
        .sort((a, b) => visitTime(a) - visitTime(b)),
      past: [...appointmentRows.filter((v) => !isUpcoming(v)), ...encounterRows].sort(
        (a, b) => visitTime(b) - visitTime(a)
      ),
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

function isRequestType(value: string | undefined): value is PatientRequestType {
  return value !== undefined && value in REQUEST_TYPE_LABELS;
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
    const tasks = await getClient().searchResources("Task", {
      requester: `Patient/${patientId}`,
    });

    // Undated to epoch 0, so it sorts last — same rule as visitTime.
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
