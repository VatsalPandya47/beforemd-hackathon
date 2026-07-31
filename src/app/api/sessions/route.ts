import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AgentState } from "@/types";

const CreateSessionSchema = z.object({
  patientFhirId: z.string().min(1),
  mode: z.enum(["live", "replay"]).default("live"),
});

export async function POST(request: NextRequest) {
  const parsed = CreateSessionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("demo_sessions")
    .insert({
      patient_fhir_id: parsed.data.patientFhirId,
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
