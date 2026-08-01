import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateVisitCost } from "./cost-estimate";
import { demoCoverageSummary, contractedRateFor } from "./demo-fixtures";
import type { ContractedRate, CoverageSummary } from "@/types";

const RATE: ContractedRate = {
  description: "Dermatology consultation",
  allowedAmountCents: 15000,
  basis: "test",
};

const coverage = (over: Partial<CoverageSummary> = {}): CoverageSummary => ({
  ...demoCoverageSummary,
  ...over,
});

test("deductible first, then coinsurance on the remainder", () => {
  const e = estimateVisitCost(coverage(), RATE, null);
  assert.equal(e.deductibleAppliedCents, 5000);
  assert.equal(e.coinsuranceCents, 2000); // 20% of the $100 left after the deductible
  assert.equal(e.patientPaysCents, 7000);
  assert.equal(e.insurancePaysCents, 8000);
  assert.equal(e.confidence, "high");
});

test("the three shares always sum to the allowed amount", () => {
  for (const c of [
    coverage(),
    coverage({ deductibleRemainingCents: 0, copayEstimateCents: 3000 }),
    coverage({ deductibleRemainingCents: 99_999 }),
    coverage({ coinsuranceRate: null, deductibleRemainingCents: null }),
  ]) {
    const e = estimateVisitCost(c, RATE, null);
    assert.equal(
      e.deductibleAppliedCents + e.coinsuranceCents + e.copayCents + e.insurancePaysCents,
      RATE.allowedAmountCents
    );
    assert.ok(e.patientPaysCents >= 0 && e.insurancePaysCents >= 0);
  }
});

test("a met deductible uses the copay, and does not also charge coinsurance", () => {
  const e = estimateVisitCost(
    coverage({ deductibleRemainingCents: 0, copayEstimateCents: 3000 }),
    RATE,
    null
  );
  assert.equal(e.copayCents, 3000);
  assert.equal(e.coinsuranceCents, 0, "double-charged copay and coinsurance");
  assert.equal(e.patientPaysCents, 3000);
});

test("a deductible larger than the visit caps at the allowed amount", () => {
  const e = estimateVisitCost(coverage({ deductibleRemainingCents: 99_999 }), RATE, null);
  assert.equal(e.deductibleAppliedCents, RATE.allowedAmountCents);
  assert.equal(e.patientPaysCents, RATE.allowedAmountCents);
  assert.equal(e.insurancePaysCents, 0);
});

test("confidence degrades on unknowns and collapses out-of-network", () => {
  assert.equal(estimateVisitCost(coverage(), RATE, null).confidence, "high");
  assert.equal(
    estimateVisitCost(coverage({ deductibleRemainingCents: null }), RATE, null).confidence,
    "medium"
  );
  assert.equal(
    estimateVisitCost(coverage({ network: "out-of-network" }), RATE, null).confidence,
    "low"
  );
  assert.equal(estimateVisitCost(coverage({ active: false }), RATE, null).confidence, "low");
});

test("the range brackets the estimate and never goes negative", () => {
  const e = estimateVisitCost(coverage(), RATE, null);
  assert.ok(e.lowCents <= e.patientPaysCents && e.patientPaysCents <= e.highCents);
  const free = estimateVisitCost(
    coverage({ deductibleRemainingCents: 0, copayEstimateCents: 0 }),
    RATE,
    null
  );
  assert.equal(free.lowCents, 0);
});

test("Maya's seeded visit description finds the dermatology rate", () => {
  assert.equal(
    contractedRateFor("Dermatology consultation - recurring rash").allowedAmountCents,
    15000
  );
  assert.equal(contractedRateFor(null).allowedAmountCents, 12000);
});
