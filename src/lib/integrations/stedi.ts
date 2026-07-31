import { flags } from "@/lib/flags";
import { demoCoverageSummary } from "@/lib/demo-fixtures";
import type { CoverageSummary, EligibilityInput, ToolResult } from "@/types";

const STEDI_BASE_URL =
  process.env.STEDI_BASE_URL ?? "https://healthcare.us.stedi.com/2024-04-01";

// Stedi test-mode eligibility check (doc section 3/12). On any failure this
// falls back to a cached successful test-mode response, labeled accordingly
// per the fallback ladder in doc section 10.
export async function checkEligibility(
  input: EligibilityInput
): Promise<ToolResult<CoverageSummary>> {
  const started = performance.now();

  if (!flags.useLiveStedi) {
    return {
      ok: true,
      source: "fixture",
      data: demoCoverageSummary,
      latencyMs: performance.now() - started,
    };
  }

  try {
    const apiKey = process.env.STEDI_API_KEY;
    if (!apiKey) {
      throw new Error("Stedi API key is not configured");
    }

    const response = await fetch(`${STEDI_BASE_URL}/change/medicalnetwork/eligibility/v3`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        payerId: input.payerId,
        subscriber: { memberId: input.memberId },
        serviceType: input.serviceType,
      }),
    });

    if (!response.ok) {
      throw new Error(`Stedi request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      planStatus?: { status: string; planDetails?: string }[];
      benefitsInformation?: { benefitAmount?: string; coverageLevel?: string }[];
    };

    const active = payload.planStatus?.some((p) => p.status === "Active") ?? false;

    const data: CoverageSummary = {
      active,
      planName: payload.planStatus?.[0]?.planDetails ?? "Unknown plan",
      network: "unknown",
      copayEstimateCents: null,
      deductibleRemainingCents: null,
    };

    return { ok: true, source: "live", data, latencyMs: performance.now() - started };
  } catch (error) {
    if (!flags.allowFixtureFallback) {
      return {
        ok: false,
        source: "live",
        error: error instanceof Error ? error.message : "Stedi request failed",
        latencyMs: performance.now() - started,
      };
    }
    return {
      ok: true,
      source: "cache",
      data: demoCoverageSummary,
      latencyMs: performance.now() - started,
    };
  }
}
