import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { demoIds } from "@/lib/flags";
import type { AgentState } from "@/types";

const CreateSessionSchema = z.object({
  // Optional so the browser never has to know the id. DEMO_PATIENT_FHIR_ID is
  // not NEXT_PUBLIC_, so a client component reads it as undefined — the landing
  // page used to send the literal string "DEMO_PATIENT_FHIR_ID" and every
  // session pointed at a patient Medplum does not have.
  patientFhirId: z.string().min(1).optional(),
  mode: z.enum(["live", "replay"]).default("live"),
});

export async function POST(request: NextRequest) {
  const parsed = CreateSessionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const patientFhirId = parsed.data.patientFhirId ?? demoIds.patientFhirId;
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
