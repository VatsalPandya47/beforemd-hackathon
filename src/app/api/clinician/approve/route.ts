import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeDraft } from "@/lib/integrations/medplum";

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

  const { data: draft } = await supabase
    .from("clinical_drafts")
    .select("*")
    .eq("session_id", sessionId)
    .single();

  const result = await writeDraft({
    sessionId,
    patientFhirId: session.patient_fhir_id,
    encounterFhirId: session.encounter_fhir_id,
    questionnaireResponse: edits ?? {},
    clinicalImpressionNote: draft?.chief_concern ?? "",
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  await supabase
    .from("clinical_drafts")
    .update({ clinician_status: "approved", updated_at: new Date().toISOString() })
    .eq("session_id", sessionId);

  return NextResponse.json({ status: "approved", ...result.data });
}
