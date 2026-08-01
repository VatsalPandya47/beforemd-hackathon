import { NextRequest, NextResponse } from "next/server";
import { getPatientContext } from "@/lib/integrations/medplum";

export async function GET(request: NextRequest) {
  const patientId = request.nextUrl.searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }

  const result = await getPatientContext(patientId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // ALLOW_FIXTURE_FALLBACK makes a live failure return ok:true with fixture data,
  // so without `source` a 200 can't be trusted to mean Medplum actually answered.
  return NextResponse.json({ ...result.data, source: result.source });
}
