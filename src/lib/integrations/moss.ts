import { MossClient } from "@inferedge/moss";
import { env as transformersEnv } from "@huggingface/transformers";
import { flags } from "@/lib/flags";
import { demoPatientContext, demoRetrievedContext } from "@/lib/demo-fixtures";
import type { PatientContext, RetrievedContext, ToolResult } from "@/types";

// Vercel's function filesystem is read-only outside /tmp. transformers.js
// defaults to caching downloaded model files inside its own package
// directory (./.cache), which fails there with ENOENT on mkdir. Point it at
// the one writable path instead.
transformersEnv.cacheDir = "/tmp/transformers-cache/";

// Moss does on-device semantic search: the index is built in their cloud, then
// pulled down and queried locally (see docs/sponsor-notes.md). The management
// API has no server-side search action — retrieval only exists in this SDK.
//
// Cost profile measured against the live project:
//   createIndex ~4.7s (one time), loadIndex ~3.2s (once per process), query ~5ms.
// So the first request pays the load and every later one is effectively free.
// Callers only ever see RetrievedContext[] — no Moss shape leaks past here.

const INDEX_NAME = process.env.MOSS_INDEX_NAME ?? "beforemd-clinical-context";
const DEFAULT_TOP_K = 3;

// Nothing may block the demo. If Moss is cold or unreachable we serve fixtures.
const LOAD_TIMEOUT_MS = 15_000;
const QUERY_TIMEOUT_MS = 5_000;

type MossDocument = {
  id: string;
  text: string;
  metadata: { sourceType: string; title: string; date: string };
};

type MossMatch = {
  id: string;
  text: string;
  score: number;
  metadata?: { sourceType?: string; title?: string; date?: string };
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Flatten a chart into searchable documents. Ids are the FHIR resource ids, so
 * a retrieved match can be traced straight back to the record it came from and
 * rendered as an evidence chip.
 */
export function buildClinicalDocuments(context: PatientContext): MossDocument[] {
  const documents: MossDocument[] = [];

  for (const medication of context.medications) {
    documents.push({
      id: medication.fhirId,
      text: `Medication ${medication.name}, status ${medication.status}, started ${
        medication.startDate ?? "unknown date"
      }.`,
      metadata: {
        sourceType: "MedicationRequest",
        title: medication.name,
        date: medication.startDate ?? "",
      },
    });
  }

  for (const condition of context.conditions) {
    documents.push({
      id: condition.fhirId,
      text: `Condition ${condition.name}, onset ${condition.onsetDate ?? "unknown"}.`,
      metadata: {
        sourceType: "Condition",
        title: condition.name,
        date: condition.onsetDate ?? "",
      },
    });
  }

  for (const allergy of context.allergies) {
    documents.push({
      id: allergy.fhirId,
      text: `Allergy to ${allergy.substance}. Reaction: ${allergy.reaction ?? "not recorded"}.`,
      metadata: { sourceType: "AllergyIntolerance", title: allergy.substance, date: "" },
    });
  }

  for (const document of context.priorDocuments) {
    documents.push({
      id: document.fhirId,
      text: `${document.title}. ${document.excerpt ?? ""}`.trim(),
      metadata: {
        sourceType: "DocumentReference",
        title: document.title,
        date: document.date ?? "",
      },
    });
  }

  return documents;
}

// Loading is per-process and expensive, so it is cached. A failure clears the
// cache so the next request retries rather than being stuck on a bad load.
let loadedClient: Promise<MossClient> | null = null;

async function getLoadedClient(): Promise<MossClient> {
  if (loadedClient) return loadedClient;

  loadedClient = (async () => {
    const projectId = process.env.MOSS_PROJECT_ID;
    const projectKey = process.env.MOSS_PROJECT_KEY;
    if (!projectId || !projectKey) {
      throw new Error("Moss project credentials are not configured");
    }

    const client = new MossClient(projectId, projectKey);

    // Self-healing: build the index on first use if it is missing, so a fresh
    // Moss project needs no manual seeding step before the demo.
    try {
      await client.getIndex(INDEX_NAME);
    } catch {
      console.warn("[moss] index missing, creating", { index: INDEX_NAME });
      // TODO: source this from live Medplum once the seeded FHIR ids land
      // (issue #8) — the shape is already PatientContext either way.
      await client.createIndex(INDEX_NAME, buildClinicalDocuments(demoPatientContext));
    }

    await withTimeout(client.loadIndex(INDEX_NAME), LOAD_TIMEOUT_MS, "Moss loadIndex");
    return client;
  })();

  try {
    return await loadedClient;
  } catch (error) {
    loadedClient = null;
    throw error;
  }
}

export async function retrieve(
  query: string,
  patientId: string
): Promise<ToolResult<RetrievedContext[]>> {
  const started = performance.now();

  if (!flags.useLiveMoss) {
    return {
      ok: true,
      source: "fixture",
      data: demoRetrievedContext,
      latencyMs: performance.now() - started,
    };
  }

  try {
    const client = await getLoadedClient();
    const result = await withTimeout(
      client.query(INDEX_NAME, query, { topK: DEFAULT_TOP_K }),
      QUERY_TIMEOUT_MS,
      "Moss query"
    );

    const matches = (result?.docs ?? []) as MossMatch[];
    const data: RetrievedContext[] = matches.map((match) => ({
      sourceId: match.id,
      sourceType: match.metadata?.sourceType ?? "Unknown",
      title: match.metadata?.title ?? match.id,
      snippet: match.text,
      relevance: match.score,
    }));

    return { ok: true, source: "live", data, latencyMs: performance.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Moss request failed";
    console.warn("[moss] retrieval failed", { patientId, message });

    if (!flags.allowFixtureFallback) {
      return {
        ok: false,
        source: "live",
        error: message,
        latencyMs: performance.now() - started,
      };
    }
    return {
      ok: true,
      source: "fixture",
      data: demoRetrievedContext,
      latencyMs: performance.now() - started,
    };
  }
}
