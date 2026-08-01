import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPatientContext,
  getVisitHistory,
  listPatientRequests,
} from "@/lib/integrations/medplum";
import type {
  PatientConversation,
  PatientOverview,
  TranscriptEvent,
} from "@/types";

const OverviewSchema = z.object({
  sessionId: z.string().uuid(),
  // "health" serves the chart alone, for the intake screen's slide-out. That
  // panel reads `patient` and `source` and nothing else, and it opens mid-voice
  // session — the full payload would spend two extra Medplum search sets and two
  // Supabase queries to render four lists it already had.
  section: z.enum(["all", "health"]).default("all"),
});

// A transcript is bounded by one conversation, but say so: PostgREST caps rows
// at 1000 silently, and with `id ASC` a silent truncation would drop the newest
// lines — the ones the patient just spoke.
const MAX_TRANSCRIPT_ROWS = 500;

// Everything the patient portal shows, in one payload.
//
// Session-scoped rather than patient-scoped: the patient FHIR id is resolved
// from the session row here on the server, so the browser never needs it.
// DEMO_PATIENT_FHIR_ID is not NEXT_PUBLIC_, and a client component that tried
// to read it would get undefined — the bug that made the landing page start
// every session on a patient that does not exist.
//
// A route rather than browser queries, for the same reason as
// api/clinician/draft: `demo_sessions` has RLS on with no policies (003 granted
// anon reads on transcript_events, agent_events and clinical_drafts only), so
// the publishable-key client cannot list a patient's sessions at all.

export async function GET(request: NextRequest) {
  const parsed = OverviewSchema.safeParse({
    sessionId: request.nextUrl.searchParams.get("sessionId"),
    section: request.nextUrl.searchParams.get("section") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sessionId, section } = parsed.data;
  const full = section === "all";

  const supabase = createAdminClient();

  const { data: session, error: sessionError } = await supabase
    .from("demo_sessions")
    .select("id, patient_fhir_id, status, mode, started_at")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const patientFhirId = session.patient_fhir_id;

  // This session only, deliberately — NOT every session for this patient.
  // Every demo run starts from the same DEMO_PATIENT_FHIR_ID, so "the patient's
  // conversations" would be everyone's: on stage the tab would show whatever the
  // previous person said into the mic, transcripts and all. One shared synthetic
  // patient makes patient-scoped history meaningless here; it becomes correct on
  // its own the day real patients have distinct ids.
  const [patient, visits, requests, transcriptRows, draftRow] = await Promise.all([
    getPatientContext(patientFhirId),
    full ? getVisitHistory(patientFhirId) : null,
    full ? listPatientRequests(patientFhirId) : null,
    full
      ? supabase
          .from("transcript_events")
          .select("id, session_id, speaker, text, is_final, sequence_no, created_at")
          .eq("session_id", sessionId)
          // By id, not sequence_no: id is `bigint generated always as identity`
          // and globally monotonic, matching use-session-events.ts.
          .order("id", { ascending: true })
          .limit(MAX_TRANSCRIPT_ROWS)
      : { data: [], error: null },
    full
      ? supabase
          .from("clinical_drafts")
          .select("session_id, chief_concern, coverage_summary")
          .eq("session_id", sessionId)
          .maybeSingle()
      : { data: null, error: null },
  ]);

  // The chart is the point of this screen; without it there is nothing to show,
  // so a failed read is an error rather than a half-rendered page. Only reachable
  // with ALLOW_FIXTURE_FALLBACK off — otherwise the adapters serve fixtures.
  const reads = [patient, visits, requests].filter((r) => r !== null);
  for (const result of reads) {
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { error: result.error ?? "Could not load this patient's record" },
        { status: 502 }
      );
    }
  }
  if (transcriptRows.error) {
    return NextResponse.json({ error: transcriptRows.error.message }, { status: 500 });
  }
  if (draftRow.error) {
    return NextResponse.json({ error: draftRow.error.message }, { status: 500 });
  }

  // Hand-written column mapping, per the convention in every other route handler.
  const transcript: TranscriptEvent[] = (transcriptRows.data ?? []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    speaker: row.speaker,
    text: row.text,
    isFinal: row.is_final,
    sequenceNo: row.sequence_no,
    createdAt: row.created_at,
  }));

  const conversations: PatientConversation[] = full
    ? [
        {
          sessionId: session.id,
          startedAt: session.started_at,
          status: session.status,
          mode: session.mode,
          chiefConcern: draftRow.data?.chief_concern ?? null,
          transcript,
        },
      ]
    : [];

  const overview: PatientOverview = {
    patient: patient.data!,
    visits: visits?.data ?? { upcoming: [], past: [], careTeam: [] },
    conversations,
    requests: requests?.data ?? [],
    coverage: draftRow.data?.coverage_summary ?? null,
    // Live only if every read that ran was — one fixture section makes the whole
    // screen demo data as far as the patient is concerned.
    source: reads.every((r) => r.source === "live") ? "live" : "fixture",
  };

  return NextResponse.json(overview, {
    // The portal is opened seconds after intake finishes, and a filed request
    // has to show up on the very next load.
    headers: { "Cache-Control": "no-store" },
  });
}
