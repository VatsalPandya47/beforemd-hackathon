import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPatientRequest } from "@/lib/integrations/medplum";

// Files a patient request as a FHIR Task in Medplum. Nothing is written to
// Supabase: a request is clinical/administrative data, and the architecture
// boundary in 001_initial.sql puts that in Medplum.
//
// The patient is resolved from the session rather than accepted from the body,
// so a caller cannot file a request against someone else's chart.
const RequestSchema = z.object({
  sessionId: z.string().uuid(),
  type: z.enum(["question", "refill", "appointment", "records"]),
  // Capped rather than unbounded: this lands in Task.description on a real
  // chart, and the form is a textarea.
  message: z.string().trim().min(1).max(1000),
  // Task.focus — the medication being refilled or the appointment being moved.
  // Constrained to the two resource types the form can produce; free text here
  // would become a dangling reference on the chart.
  focusReference: z
    .string()
    .regex(
      /^(MedicationRequest|Appointment)\/[A-Za-z0-9\-.]{1,64}$/,
      "focusReference must be MedicationRequest/<id> or Appointment/<id>"
    )
    .optional(),
});

export async function POST(request: NextRequest) {
  const parsed = RequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sessionId, type, message, focusReference } = parsed.data;

  const supabase = createAdminClient();
  const { data: session, error: sessionError } = await supabase
    .from("demo_sessions")
    .select("patient_fhir_id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const result = await createPatientRequest({
    patientFhirId: session.patient_fhir_id,
    type,
    message,
    focusReference,
  });

  // createPatientRequest has no fixture branch — there is no id to invent that
  // would not be a lie to the patient — so a failure here means nothing was
  // filed, and the message says so rather than only reaching the log.
  if (!result.ok || !result.data) {
    console.error("[patient/request] file failed", {
      sessionId,
      type,
      source: result.source,
      error: result.error,
    });
    return NextResponse.json(
      { error: result.error ?? "Your request could not be filed.", source: result.source },
      { status: 502 }
    );
  }

  return NextResponse.json({ request: result.data, source: result.source });
}
