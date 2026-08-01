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

const OverviewSchema = z.object({ sessionId: z.string().uuid() });

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

// Conversations ship with their transcripts inline. Capped because the payload
// grows with every past session and nobody scrolls back further than this.
const MAX_CONVERSATIONS = 10;

export async function GET(request: NextRequest) {
  const parsed = OverviewSchema.safeParse({
    sessionId: request.nextUrl.searchParams.get("sessionId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sessionId } = parsed.data;

  const supabase = createAdminClient();

  const { data: session, error: sessionError } = await supabase
    .from("demo_sessions")
    .select("patient_fhir_id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const patientFhirId = session.patient_fhir_id;

  const { data: sessionRows, error: sessionsError } = await supabase
    .from("demo_sessions")
    .select("id, status, mode, started_at")
    .eq("patient_fhir_id", patientFhirId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(MAX_CONVERSATIONS);

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const sessionIds = (sessionRows ?? []).map((row) => row.id);

  const [patient, visits, requests, transcriptRows, draftRows] = await Promise.all([
    getPatientContext(patientFhirId),
    getVisitHistory(patientFhirId),
    listPatientRequests(patientFhirId),
    sessionIds.length
      ? supabase
          .from("transcript_events")
          .select("id, session_id, speaker, text, is_final, sequence_no, created_at")
          .in("session_id", sessionIds)
          // By id, not sequence_no: sequence numbers restart per session, and
          // these rows span several.
          .order("id", { ascending: true })
      : { data: [], error: null },
    sessionIds.length
      ? supabase
          .from("clinical_drafts")
          .select("session_id, chief_concern, coverage_summary")
          .in("session_id", sessionIds)
      : { data: [], error: null },
  ]);

  // The chart is the point of this screen; without it there is nothing to show,
  // so a failed read is an error rather than a half-rendered page. Only reachable
  // with ALLOW_FIXTURE_FALLBACK off — otherwise the adapters serve fixtures.
  for (const result of [patient, visits, requests]) {
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
  if (draftRows.error) {
    return NextResponse.json({ error: draftRows.error.message }, { status: 500 });
  }

  // Hand-written column mapping, per the convention in every other route handler.
  const transcriptsBySession = new Map<string, TranscriptEvent[]>();
  for (const row of transcriptRows.data ?? []) {
    const events = transcriptsBySession.get(row.session_id) ?? [];
    events.push({
      id: row.id,
      sessionId: row.session_id,
      speaker: row.speaker,
      text: row.text,
      isFinal: row.is_final,
      sequenceNo: row.sequence_no,
      createdAt: row.created_at,
    });
    transcriptsBySession.set(row.session_id, events);
  }

  const draftsBySession = new Map(
    (draftRows.data ?? []).map((row) => [row.session_id, row])
  );

  const conversations: PatientConversation[] = (sessionRows ?? []).map((row) => ({
    sessionId: row.id,
    startedAt: row.started_at,
    status: row.status,
    mode: row.mode,
    chiefConcern: draftsBySession.get(row.id)?.chief_concern ?? null,
    transcript: transcriptsBySession.get(row.id) ?? [],
  }));

  const overview: PatientOverview = {
    patient: patient.data!,
    visits: visits.data!,
    conversations,
    requests: requests.data!,
    coverage: draftsBySession.get(sessionId)?.coverage_summary ?? null,
    // Live only if every read was — one fixture section makes the whole screen
    // demo data as far as the patient is concerned.
    source: [patient, visits, requests].every((r) => r.source === "live")
      ? "live"
      : "fixture",
  };

  return NextResponse.json(overview, {
    // The portal is opened seconds after intake finishes, and a filed request
    // has to show up on the very next load.
    headers: { "Cache-Control": "no-store" },
  });
}
