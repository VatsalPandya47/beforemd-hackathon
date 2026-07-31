import { flags } from "@/lib/flags";
import { demoRetrievedContext } from "@/lib/demo-fixtures";
import type { RetrievedContext, ToolResult } from "@/types";

// Moss endpoint/response shape is unconfirmed until sponsor check-in (doc
// section 6). Only this function's internals should change once credentials
// land — callers only ever see RetrievedContext[].
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
    const apiUrl = process.env.MOSS_API_URL;
    const apiKey = process.env.MOSS_API_KEY;
    if (!apiUrl || !apiKey) {
      throw new Error("Moss API credentials are not configured");
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, patientId }),
    });

    if (!response.ok) {
      throw new Error(`Moss request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { results?: RetrievedContext[] };

    return {
      ok: true,
      source: "live",
      data: payload.results ?? [],
      latencyMs: performance.now() - started,
    };
  } catch (error) {
    if (!flags.allowFixtureFallback) {
      return {
        ok: false,
        source: "live",
        error: error instanceof Error ? error.message : "Moss request failed",
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
