import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeDraft } from "@/lib/integrations/medplum";
import type { ApproveErrorResponse, ApproveResponse } from "@/types";

const ApproveSchema = z.object({
  sessionId: z.string().uuid(),
  edits: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = ApproveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sessionId, edits } = parsed.data;

  const supabase = createAdminClient();
  const { data: session, error: sessionError } = await supabase
    .from("demo_sessions")
    .select("patient_fhir_id, encounter_fhir_id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: draft, error: draftError } = await supabase
    .from("clinical_drafts")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (draftError) {
    return NextResponse.json({ error: draftError.message }, { status: 500 });
  }

  // Mirrors the client-side guard in clinician/[sessionId]/page.tsx (#30), but
  // enforced here too: a disabled button is not a security boundary, and
  // writeDraft has no fixture fallback — skipping this would write an empty
  // ClinicalImpression to the real chart for a session that never produced
  // a draft, under whatever edits were POSTed alongside it.
  if (!draft) {
    const body: ApproveErrorResponse = {
      error: "This session has no saved draft, so it cannot be approved.",
      source: "fixture",
    };
    return NextResponse.json(body, { status: 409 });
  }

  const result = await writeDraft({
    sessionId,
    patientFhirId: session.patient_fhir_id,
    encounterFhirId: session.encounter_fhir_id,
    questionnaireResponse: edits ?? {},
    clinicalImpressionNote: draft.chief_concern ?? "",
  });

  // Unlike the read path, writeDraft has no fixture fallback on failure — it
  // ignores ALLOW_FIXTURE_FALLBACK — so this branch means nothing reached the
  // chart. The message goes to the client rather than only the log: the
  // clinician screen has to be able to say so out loud.
  if (!result.ok || !result.data) {
    const body: ApproveErrorResponse = {
      error: result.error ?? "Medplum write failed",
      source: result.source,
    };
    console.error("[clinician/approve] write-back failed", { sessionId, ...body });
    return NextResponse.json(body, { status: 502 });
  }

  await supabase
    .from("clinical_drafts")
    .update({ clinician_status: "approved", updated_at: new Date().toISOString() })
    .eq("session_id", sessionId);

  const body: ApproveResponse = {
    status: "approved",
    source: result.source,
    ...result.data,
  };
  return NextResponse.json(body);
}
