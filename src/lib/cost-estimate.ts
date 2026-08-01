import { contractedRateFor } from "@/lib/demo-fixtures";
import type { ContractedRate, CostEstimate, CoverageSummary, VisitSummary } from "@/types";

// What the patient owes for a visit, from their benefits and the contracted
// rate. Deterministic and pure — the LLM explains the output of this function
// and never produces a number itself (see lib/agent/llm.ts explainCost).
//
// Two ways a plan charges for an office visit, and they are alternatives rather
// than additive:
//
//   deductible not yet met -> the patient pays the visit down to the deductible,
//                             then coinsurance on whatever is left
//   deductible met + copay -> a flat copay, insurance takes the rest
//
// Applying both would double-charge, so `copay` is only used once the deductible
// is satisfied.

// Band around the patient's share. Wide enough to be honest about the mocked
// contracted rate without being useless — a real estimate would derive this from
// the spread of historical reimbursements for the service.
const RANGE_FRACTION = 0.15;
const ROUND_TO_CENTS = 500;

const CONFIDENCE_LABELS = { high: 92, medium: 74, low: 55 } as const;

/** Rounds to the nearest $5 so the range reads as an estimate, not a quote. */
function roundToNearest(cents: number, step: number): number {
  return Math.round(cents / step) * step;
}

function confidenceFor(
  coverage: CoverageSummary
): { confidence: CostEstimate["confidence"]; confidencePct: number } {
  // Inactive or out-of-network is not a small penalty — the benefits used for
  // the math may not be the ones that apply at all.
  if (!coverage.active || coverage.network === "out-of-network") {
    return { confidence: "low", confidencePct: CONFIDENCE_LABELS.low };
  }

  const unknowns =
    (coverage.deductibleRemainingCents === null ? 1 : 0) +
    (coverage.coinsuranceRate === null && coverage.copayEstimateCents === null ? 1 : 0) +
    (coverage.network === "unknown" ? 1 : 0);

  if (unknowns === 0) return { confidence: "high", confidencePct: CONFIDENCE_LABELS.high };
  if (unknowns === 1) return { confidence: "medium", confidencePct: CONFIDENCE_LABELS.medium };
  return { confidence: "low", confidencePct: CONFIDENCE_LABELS.low };
}

export function estimateVisitCost(
  coverage: CoverageSummary,
  rate: ContractedRate,
  visit: VisitSummary | null
): CostEstimate {
  const allowed = rate.allowedAmountCents;

  // A null deductible means "not reported", not "zero owed". Treating it as 0
  // would quote the patient the cheaper of the two possibilities; assuming the
  // full allowed amount would be alarmist. Assume met, and drop confidence
  // instead — confidenceFor() already counts this as an unknown.
  const deductibleRemaining = coverage.deductibleRemainingCents ?? 0;
  const deductibleApplied = Math.min(Math.max(deductibleRemaining, 0), allowed);
  const afterDeductible = allowed - deductibleApplied;

  const deductibleMet = deductibleApplied === 0;
  const useCopay = deductibleMet && coverage.copayEstimateCents !== null;

  const copay = useCopay ? Math.min(coverage.copayEstimateCents!, allowed) : 0;
  const coinsurance = useCopay
    ? 0
    : Math.round(afterDeductible * (coverage.coinsuranceRate ?? 0));

  const patientPays = deductibleApplied + coinsurance + copay;
  const insurancePays = allowed - patientPays;

  const { confidence, confidencePct } = confidenceFor(coverage);
  const spread = roundToNearest(patientPays * RANGE_FRACTION, ROUND_TO_CENTS);

  const assumptions = [
    coverage.network === "in-network"
      ? "This provider is in your plan's network"
      : "Network status for this provider is unconfirmed",
    "Office visit only — no labs, imaging or procedures",
    `Based on your plan's benefits as of today${coverage.active ? "" : " (coverage is not currently active)"}`,
  ];

  return {
    serviceDescription: visit?.description ?? rate.description,
    appointmentFhirId: visit?.fhirId ?? null,
    appointmentDate: visit?.date ?? null,

    allowedAmountCents: allowed,
    deductibleAppliedCents: deductibleApplied,
    coinsuranceCents: coinsurance,
    copayCents: copay,
    insurancePaysCents: insurancePays,
    patientPaysCents: patientPays,

    // Never quote a negative floor, and never let the floor exceed the estimate.
    lowCents: Math.max(0, patientPays - spread),
    highCents: patientPays + spread,
    confidence,
    confidencePct,

    planName: coverage.planName,
    network: coverage.network,
    deductibleRemainingCents: coverage.deductibleRemainingCents,
    coinsuranceRate: coverage.coinsuranceRate,
    rateBasis: rate.basis,

    assumptions,
    couldChange: [
      "Lab work is ordered",
      "Imaging is added",
      "A procedure such as a biopsy is performed",
      "Your deductible changes before the visit from another claim",
    ],
  };
}

/** The estimate for a patient's next visit — picks the rate from its description. */
export function estimateForVisit(
  coverage: CoverageSummary,
  visit: VisitSummary | null
): CostEstimate {
  return estimateVisitCost(coverage, contractedRateFor(visit?.description ?? null), visit);
}

