import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVisitHistory, saveCostEstimate } from "@/lib/integrations/medplum";
import { checkEligibility, STEDI_DEMO_REQUEST } from "@/lib/integrations/stedi";
import { estimateForVisit } from "@/lib/cost-estimate";
import type { CoverageSummary } from "@/types";

// "Proceed with appointment" — writes the accepted estimate to the chart as a
// predetermination Claim.
//
// The estimate is recomputed server-side rather than accepted from the body. It
// is about to become a record of what the patient was quoted, so a caller must
// not be able to write an amount the server never calculated.
const AcceptSchema = z.object({ sessionId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const parsed = AcceptSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sessionId } = parsed.data;

  const supabase = createAdminClient();
  const { data: session, error: sessionError } = await supabase
    .from("demo_sessions")
    .select("patient_fhir_id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
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
    return NextResponse.json(
      { error: visits.error ?? "Could not load your upcoming visit", source: visits.source },
      { status: 502 }
    );
  }

  let coverage = draftRow.data?.coverage_summary as CoverageSummary | null | undefined;
  if (!coverage) {
    const eligibility = await checkEligibility({ patientFhirId, ...STEDI_DEMO_REQUEST });
    if (!eligibility.ok || !eligibility.data) {
      return NextResponse.json(
        {
          error: eligibility.error ?? "Could not check your insurance benefits",
          source: eligibility.source,
        },
        { status: 502 }
      );
    }
    coverage = eligibility.data;
  }

  const estimate = estimateForVisit(coverage, visits.data.upcoming[0] ?? null);
  const result = await saveCostEstimate({ patientFhirId, estimate });

  // saveCostEstimate has no fixture branch, same as createPatientRequest: there
  // is no Claim id to invent that would not be a lie about what is on the chart.
  if (!result.ok || !result.data) {
    console.error("[patient/estimate/accept] save failed", {
      sessionId,
      source: result.source,
      error: result.error,
    });
    return NextResponse.json(
      { error: result.error ?? "Your estimate could not be saved.", source: result.source },
      { status: 502 }
    );
  }

  return NextResponse.json({ saved: result.data, source: result.source });
}
