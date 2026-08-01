import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkEligibility } from "@/lib/integrations/stedi";
import { createAdminClient } from "@/lib/supabase/admin";

const EligibilitySchema = z.object({
  sessionId: z.string().uuid(),
  patientFhirId: z.string().min(1),
  payerId: z.string().min(1),
  memberId: z.string().min(1),
  serviceType: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const parsed = EligibilitySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { sessionId, ...eligibilityInput } = parsed.data;
  const result = await checkEligibility(eligibilityInput);

  if (result.ok && result.data) {
    const supabase = createAdminClient();
    await supabase.from("integration_cache").upsert(
      {
        session_id: sessionId,
        provider: "stedi",
        request_key: `${eligibilityInput.payerId}:${eligibilityInput.memberId}`,
        response: result.data,
      },
      { onConflict: "session_id,provider,request_key" }
    );
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // ALLOW_FIXTURE_FALLBACK makes a live failure return ok:true with fixture data,
  // so without `source` a 200 can't be trusted to mean Stedi actually answered.
  // For logs and dev tools — not for display.
  return NextResponse.json({ ...result.data, source: result.source });
}
