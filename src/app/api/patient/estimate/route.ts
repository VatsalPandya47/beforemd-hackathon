import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVisitHistory } from "@/lib/integrations/medplum";
import { checkEligibility, STEDI_DEMO_REQUEST } from "@/lib/integrations/stedi";
import { estimateForVisit } from "@/lib/cost-estimate";
import { explainCost } from "@/lib/agent/llm";
import type { CostEstimateResponse, CoverageSummary, ToolSource } from "@/types";

// The patient's cost estimate for their next visit, split across two handlers on
// purpose:
//
//   GET  — the numbers. Deterministic, no model call, so the tab renders at once.
//   POST — the explanation and follow-up answers. Model latency never blocks the
//          breakdown, and a slow or dead model degrades one paragraph rather
//          than the screen.
//
// The patient is resolved from the session, never accepted from the body — same
// rule as /api/patient/request and /api/sessions.

const SessionSchema = z.object({ sessionId: z.string().uuid() });

const ExplainSchema = z.object({
  sessionId: z.string().uuid(),
  // Free text from the patient, capped like the request form's message. Absent
  // means "give me the opening explanation".
  question: z.string().trim().min(1).max(500).optional(),
});

type Resolved = {
  patientFhirId: string;
  coverage: CoverageSummary;
  estimate: ReturnType<typeof estimateForVisit>;
  source: ToolSource;
};

/**
 * Session -> coverage -> next visit -> estimate. Shared by both handlers so the
 * explanation is always describing the same numbers the panel is showing.
 */
async function resolveEstimate(
  sessionId: string
): Promise<{ ok: true; data: Resolved } | { ok: false; status: number; error: string }> {
  const supabase = createAdminClient();

  const { data: session, error: sessionError } = await supabase
    .from("demo_sessions")
    .select("patient_fhir_id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return { ok: false, status: 404, error: "Session not found" };
  }
  const patientFhirId = session.patient_fhir_id;

  const [draftRow, visits] = await Promise.all([
    supabase
      .from("clinical_drafts")
      .select("coverage_summary")
      .eq("session_id", sessionId)
      .maybeSingle(),
    getVisitHistory(patientFhirId),
  ]);

  if (!visits.ok || !visits.data) {
    return {
      ok: false,
      status: 502,
      error: visits.error ?? "Could not load your upcoming visit",
    };
  }

  // Prefer the coverage the agent already checked and persisted for this
  // session. Falling back to a fresh eligibility call matters: the Cost tab is
  // reachable before the agent reaches CHECK_ELIGIBILITY, and without this it
  // would sit empty on a new session.
  let coverage = draftRow.data?.coverage_summary as CoverageSummary | null | undefined;
  let coverageSource: ToolSource = "cache";

  if (!coverage) {
    const eligibility = await checkEligibility({ patientFhirId, ...STEDI_DEMO_REQUEST });
    if (!eligibility.ok || !eligibility.data) {
      return {
        ok: false,
        status: 502,
        error: eligibility.error ?? "Could not check your insurance benefits",
      };
    }
    coverage = eligibility.data;
    coverageSource = eligibility.source;
  }

  // The soonest upcoming visit — Maya's seeded dermatology appointment in the
  // demo. splitVisits already sorts upcoming soonest-first and excludes
  // cancelled ones, so [0] is the visit being estimated.
  const visit = visits.data.upcoming[0] ?? null;

  return {
    ok: true,
    data: {
      patientFhirId,
      coverage,
      estimate: estimateForVisit(coverage, visit),
      // The weakest link, same convention as /api/patient/overview: one fixture
      // input makes the whole estimate demo data as far as the patient is
      // concerned.
      source: visits.source === "live" && coverageSource === "live" ? "live" : coverageSource,
    },
  };
}

export async function GET(request: NextRequest) {
  const parsed = SessionSchema.safeParse({
    sessionId: request.nextUrl.searchParams.get("sessionId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const resolved = await resolveEstimate(parsed.data.sessionId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const body: CostEstimateResponse = {
    estimate: resolved.data.estimate,
    coverage: resolved.data.coverage,
    source: resolved.data.source,
  };

  return NextResponse.json(body, {
    // The deductible moves as other claims land, and the estimate is shown next
    // to a "proceed" button — a stale number here is one the patient acts on.
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const parsed = ExplainSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const resolved = await resolveEstimate(parsed.data.sessionId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  // Recomputed rather than taken from the request body: an explanation is only
  // trustworthy if it describes the numbers the server stands behind.
  const explanation = await explainCost({
    estimate: resolved.data.estimate,
    question: parsed.data.question,
  });

  return NextResponse.json(explanation, { headers: { "Cache-Control": "no-store" } });
}
