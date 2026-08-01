import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { demoIds } from "@/lib/flags";
import type { AgentState } from "@/types";

// No patientFhirId. The browser cannot supply it — DEMO_PATIENT_FHIR_ID is not
// NEXT_PUBLIC_, so the landing page used to send the literal string
// "DEMO_PATIENT_FHIR_ID" and every session pointed at a patient Medplum does not
// have. Taking it from the server env instead of the body is not just a fix for
// that: this route has no auth and runs on the service role, and the session id
// it returns is what GET /api/patient/overview and POST /api/patient/request
// resolve their patient from. Accepting a caller-chosen id here would make those
// two an unauthenticated read/write handle for any chart in the project.
const CreateSessionSchema = z.object({
  mode: z.enum(["live", "replay"]).default("live"),
});

export async function POST(request: NextRequest) {
  const parsed = CreateSessionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const patientFhirId = demoIds.patientFhirId;
  if (!patientFhirId) {
    return NextResponse.json(
      { error: "No patient to start a session for: DEMO_PATIENT_FHIR_ID is not set." },
      { status: 500 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("demo_sessions")
    .insert({
      patient_fhir_id: patientFhirId,
      // Without this the column stays null, and writeDraft then omits the
      // encounter reference — the intake answers end up unattached to the visit.
      encounter_fhir_id: demoIds.encounterFhirId || null,
      mode: parsed.data.mode,
      status: "CONSENT" satisfies AgentState,
      started_at: new Date().toISOString(),
    })
    .select("id, status")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessionId: data.id, status: data.status });
}
