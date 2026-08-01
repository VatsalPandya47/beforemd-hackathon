import { MedplumClient } from "@medplum/core";
import { flags } from "@/lib/flags";
import { demoPatientContext } from "@/lib/demo-fixtures";
import type {
  AllergyIntolerance,
  Condition,
  DocumentReference,
  MedicationRequest,
} from "@medplum/fhirtypes";
import type {
  DraftWriteInput,
  FhirWriteResult,
  PatientContext,
  ToolResult,
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

// Medplum is the clinical source of truth; Supabase never duplicates the full
// FHIR record (see doc section 3 architecture boundary).
export async function getPatientContext(
  patientId: string
): Promise<ToolResult<PatientContext>> {
  const started = performance.now();

  if (!flags.useLiveMedplum) {
    return {
      ok: true,
      source: "fixture",
      data: { ...demoPatientContext, patientFhirId: patientId },
      latencyMs: performance.now() - started,
    };
  }

  try {
    await ensureAuth();
    const medplum = getClient();

    const [patient, medicationRequests, conditions, allergies, documents] =
      await Promise.all([
        medplum.readResource("Patient", patientId),
        medplum.searchResources("MedicationRequest", { subject: patientId }),
        medplum.searchResources("Condition", { subject: patientId }),
        medplum.searchResources("AllergyIntolerance", { patient: patientId }),
        medplum.searchResources("DocumentReference", { subject: patientId }),
      ]);

    const data: PatientContext = {
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

    return { ok: true, source: "live", data, latencyMs: performance.now() - started };
  } catch (error) {
    if (!flags.allowFixtureFallback) {
      return {
        ok: false,
        source: "live",
        error: error instanceof Error ? error.message : "Medplum request failed",
        latencyMs: performance.now() - started,
      };
    }
    return {
      ok: true,
      source: "fixture",
      data: { ...demoPatientContext, patientFhirId: patientId },
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
