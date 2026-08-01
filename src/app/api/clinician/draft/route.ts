import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { demoClinicalDraft } from "@/lib/demo-fixtures";
import type { ClinicalDraft } from "@/types";

const DraftSchema = z.object({ sessionId: z.string().uuid() });

// Reads the clinician draft the agent actually produced for a session (#30).
// This exists as a route rather than a browser query because RLS is enabled on
// clinical_drafts with no policies by design — the publishable-key client can
// read nothing, so every read goes through the service role here.
//
// `source` follows the same convention as the sponsor adapters: it says where
// what you are looking at came from, and callers use it for provenance only.
// A session that never reached the agent has no row, and the fixture keeps the
// screen openable — but it is labelled as a fixture rather than passed off as
// this patient's draft, which is the whole point of this ticket.

export async function GET(request: NextRequest) {
  const parsed = DraftSchema.safeParse({
    sessionId: request.nextUrl.searchParams.get("sessionId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sessionId } = parsed.data;

  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("clinical_drafts")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json(
      { draft: { ...demoClinicalDraft, sessionId }, source: "fixture" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // Hand-written column mapping, per the convention in every other route
  // handler. Kept field-for-field identical to the twin in
  // `api/agent/turn/route.ts` — if one gains a column, so must the other.
  const draft: ClinicalDraft = {
    sessionId,
    chiefConcern: row.chief_concern ?? "",
    historyOfPresentIllness: row.hpi ?? demoClinicalDraft.historyOfPresentIllness,
    timeline: row.timeline ?? [],
    safetyFlags: row.red_flags ?? [],
    keyConnection: row.key_connection ?? null,
    unresolvedQuestions: row.unresolved_questions ?? [],
    clinicianReviewNotes: row.assessment_support ?? [],
    patientFriendlySummary: row.patient_summary ?? "",
    coverageSummary: row.coverage_summary ?? null,
    clinicianStatus: row.clinician_status ?? "draft",
  };

  return NextResponse.json(
    { draft, source: "live" },
    // The draft changes as the conversation advances, and the clinician screen
    // is often opened seconds after the last turn commits.
    { headers: { "Cache-Control": "no-store" } }
  );
}
