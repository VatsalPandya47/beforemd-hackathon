import { flags } from "@/lib/flags";
import { demoCoverageSummary } from "@/lib/demo-fixtures";
import type { CoverageSummary, EligibilityInput, ToolResult } from "@/types";

const STEDI_BASE_URL =
  process.env.STEDI_BASE_URL ?? "https://healthcare.us.stedi.com/2024-04-01";

// Provider identity sent on the 270. The NPI below is Stedi's documented test
// NPI; it only resolves in test mode.
const PROVIDER_ORGANIZATION = process.env.STEDI_PROVIDER_ORG ?? "BeforeMD";
const PROVIDER_NPI = process.env.STEDI_PROVIDER_NPI ?? "1999999984";

// Synthetic subscriber recognised by Stedi's test payer (see
// docs/sponsor-notes.md). Maya Thompson is not a real member of a real payer,
// so eligibility runs against this test identity.
const DEMO_SUBSCRIBER_FIRST_NAME = process.env.STEDI_TEST_FIRST_NAME ?? "Jane";
const DEMO_SUBSCRIBER_LAST_NAME = process.env.STEDI_TEST_LAST_NAME ?? "Doe";

// Aetna test payer + member, and the service types for a specialist office
// visit: 30 (Health Benefit Plan Coverage) and 98 (Professional Physician
// Visit - Office). 98 is what carries the office-visit copay.
export const STEDI_DEMO_REQUEST = {
  payerId: process.env.STEDI_TRADING_PARTNER_ID ?? "60054",
  memberId: process.env.STEDI_TEST_MEMBER_ID ?? "AETNA12345",
  serviceType: "30",
} as const;

const OFFICE_VISIT_SERVICE_TYPE = "98";

// Eligibility benefit codes from the 271 (EB01).
const BENEFIT_ACTIVE = "1";
const BENEFIT_COPAY = "B";
const BENEFIT_DEDUCTIBLE = "C";

type BenefitInformation = {
  code?: string;
  name?: string;
  serviceTypeCodes?: string[];
  benefitAmount?: string | null;
  timeQualifier?: string;
  inPlanNetworkIndicator?: string;
};

type EligibilityResponse = {
  planStatus?: {
    statusCode?: string;
    status?: string;
    planDetails?: string;
    serviceTypeCodes?: string[];
  }[];
  benefitsInformation?: BenefitInformation[];
  payer?: { name?: string };
  errors?: { field?: string; description?: string }[];
};

function isInNetwork(benefit: BenefitInformation): boolean {
  return benefit.inPlanNetworkIndicator === "Yes";
}

function dollarsToCents(amount: string | null | undefined): number | null {
  if (!amount) return null;
  const value = Number.parseFloat(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

function nineDigitControlNumber(): string {
  return String(Math.floor(100_000_000 + Math.random() * 900_000_000));
}

/**
 * Collapse a 271 into the CoverageSummary the UI renders. The 271 lists every
 * benefit tier the plan has, so we select the in-network entry for the office
 * visit rather than taking the first of each kind.
 */
export function normalizeEligibility(
  payload: EligibilityResponse,
  requestedServiceType: string
): CoverageSummary {
  const planStatus = payload.planStatus ?? [];
  const benefits = payload.benefitsInformation ?? [];

  const active = planStatus.some((status) => status.statusCode === BENEFIT_ACTIVE);

  const relevantServiceTypes = new Set([requestedServiceType, OFFICE_VISIT_SERVICE_TYPE]);
  const coversRelevantService = (benefit: BenefitInformation) =>
    (benefit.serviceTypeCodes ?? []).some((code) => relevantServiceTypes.has(code));

  // Prefer the office-visit copay, then any in-network copay for the requested
  // service type. Out-of-network tiers are ignored — quoting one as "your
  // copay" would overstate the cost to the patient.
  const copayBenefit =
    benefits.find(
      (benefit) =>
        benefit.code === BENEFIT_COPAY &&
        isInNetwork(benefit) &&
        (benefit.serviceTypeCodes ?? []).includes(OFFICE_VISIT_SERVICE_TYPE)
    ) ??
    benefits.find(
      (benefit) =>
        benefit.code === BENEFIT_COPAY && isInNetwork(benefit) && coversRelevantService(benefit)
    );

  const deductibleBenefit = benefits.find(
    (benefit) =>
      benefit.code === BENEFIT_DEDUCTIBLE &&
      benefit.timeQualifier === "Remaining" &&
      isInNetwork(benefit) &&
      coversRelevantService(benefit)
  );

  // A 271 describes the plan's benefit tiers, not whether one specific clinic
  // participates. In-network benefits existing for this service is the
  // strongest claim the data supports.
  const hasInNetworkBenefits = benefits.some(
    (benefit) => isInNetwork(benefit) && coversRelevantService(benefit)
  );

  return {
    active,
    planName:
      planStatus.find((status) => status.planDetails)?.planDetails ??
      payload.payer?.name ??
      "Unknown plan",
    network: hasInNetworkBenefits ? "in-network" : "unknown",
    copayEstimateCents: dollarsToCents(copayBenefit?.benefitAmount),
    deductibleRemainingCents: dollarsToCents(deductibleBenefit?.benefitAmount),
  };
}

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
        // Stedi expects the raw key with no "Bearer " prefix.
        Authorization: apiKey,
      },
      body: JSON.stringify({
        controlNumber: nineDigitControlNumber(),
        tradingPartnerServiceId: input.payerId,
        provider: {
          organizationName: PROVIDER_ORGANIZATION,
          npi: PROVIDER_NPI,
        },
        subscriber: {
          firstName: input.subscriberFirstName ?? DEMO_SUBSCRIBER_FIRST_NAME,
          lastName: input.subscriberLastName ?? DEMO_SUBSCRIBER_LAST_NAME,
          memberId: input.memberId,
        },
        encounter: {
          serviceTypeCodes: [input.serviceType, OFFICE_VISIT_SERVICE_TYPE],
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Stedi request failed with status ${response.status}: ${detail.slice(0, 200)}`
      );
    }

    const payload = (await response.json()) as EligibilityResponse;

    if (!payload.planStatus?.length) {
      const firstError = payload.errors?.[0]?.description;
      throw new Error(firstError ?? "Stedi returned no plan status");
    }

    return {
      ok: true,
      source: "live",
      data: normalizeEligibility(payload, input.serviceType),
      latencyMs: performance.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stedi request failed";
    console.warn("[stedi] eligibility check failed", { message });

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
      source: "cache",
      data: demoCoverageSummary,
      latencyMs: performance.now() - started,
    };
  }
}
