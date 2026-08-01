import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAgentTurn, STATE_ORDER } from "@/lib/agent/orchestrator";
import { initialSafetyFlags } from "@/lib/agent/safety";
import { demoClinicalDraft } from "@/lib/demo-fixtures";
import type { AgentState, ClinicalDraft, TranscriptEvent } from "@/types";

// RETRIEVE_SUPPORTING_CONTEXT's cold path alone budgets up to 20s (Moss's own
// LOAD_TIMEOUT_MS 15s + QUERY_TIMEOUT_MS 5s), on top of whatever LLM and
// Medplum/Stedi calls a turn also makes. Explicit rather than left to the
// platform default so a slow cold start fails as a clean timeout rather than
// however the default happens to be configured.
export const maxDuration = 60;

const AgentTurnSchema = z
  .object({
    sessionId: z.string().uuid(),
    // Every turn but one is driven by something the patient said. The opening
    // turn is the exception: the agent introduces itself when the mic goes
    // live, so there is no utterance behind it.
    utterance: z.string().min(1).optional(),
    kind: z.enum(["utterance", "opening"]).default("utterance"),
  })
  .refine((body) => body.kind === "opening" || Boolean(body.utterance), {
    message: "utterance is required",
    path: ["utterance"],
  });

export async function POST(request: NextRequest) {
  const parsed = AgentTurnSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sessionId, kind } = parsed.data;
  const utterance = parsed.data.utterance ?? "";
  const isOpening = kind === "opening";

  const supabase = createAdminClient();

  const { data: session, error: sessionError } = await supabase
    .from("demo_sessions")
    .select("id, patient_fhir_id, status")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const currentState: AgentState = STATE_ORDER.includes(session.status as AgentState)
    ? (session.status as AgentState)
    : "CONSENT";

  // The opening turn is only ever the first turn of a session. Starting the mic
  // again mid-conversation — after "End voice session", or after a reload —
  // must not re-introduce the agent or advance the state machine a second time,
  // which would leave the patient's next answer handled by the wrong state.
  // Answered before any write so a repeat start changes nothing at all.
  if (isOpening && currentState !== "CONSENT") {
    return NextResponse.json({ reply: null, nextState: currentState, toolEvents: [] });
  }

  const { data: draftRow } = await supabase
    .from("clinical_drafts")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();

  const draft: ClinicalDraft = draftRow
    ? {
        sessionId,
        chiefConcern: draftRow.chief_concern ?? "",
        historyOfPresentIllness: draftRow.hpi ?? demoClinicalDraft.historyOfPresentIllness,
        timeline: draftRow.timeline ?? [],
        safetyFlags: draftRow.red_flags ?? [],
        keyConnection: draftRow.key_connection ?? null,
        unresolvedQuestions: draftRow.unresolved_questions ?? [],
        clinicianReviewNotes: draftRow.assessment_support ?? [],
        patientFriendlySummary: draftRow.patient_summary ?? "",
        coverageSummary: draftRow.coverage_summary ?? null,
        clinicianStatus: draftRow.clinician_status ?? "draft",
      }
    : // A new session has screened nothing yet. Seeding from the fixture would
      // start every flag at "absent", so the clinician brief would report the
      // red-flag screen as answered before the patient had said a word.
      { ...demoClinicalDraft, sessionId, safetyFlags: initialSafetyFlags() };

  // Recent turns give the agent conversational context. Fetched before the
  // current utterance is inserted, so it holds prior turns only — the current
  // one is passed to runAgentTurn separately.
  const { data: recentEvents } = await supabase
    .from("transcript_events")
    .select("id, speaker, text, is_final, sequence_no, created_at")
    .eq("session_id", sessionId)
    .order("sequence_no", { ascending: false })
    .limit(20);

  const priorTranscript: TranscriptEvent[] = (recentEvents ?? [])
    .slice()
    .reverse()
    .map((row) => ({
      id: row.id,
      sessionId,
      speaker: row.speaker as TranscriptEvent["speaker"],
      text: row.text,
      isFinal: row.is_final,
      sequenceNo: row.sequence_no,
      createdAt: row.created_at,
    }));

  let sequenceNo = (recentEvents?.[0]?.sequence_no ?? -1) + 1;

  // Nothing goes in as a patient row on the opening turn — an empty one would
  // render as a blank bubble and replay would stream it back the same way.
  if (!isOpening) {
    await supabase.from("transcript_events").insert({
      session_id: sessionId,
      speaker: "patient",
      text: utterance,
      sequence_no: sequenceNo++,
    });
  }

  const result = await runAgentTurn(
    sessionId,
    session.patient_fhir_id,
    currentState,
    utterance,
    draft,
    priorTranscript
  );

  await supabase.from("transcript_events").insert({
    session_id: sessionId,
    speaker: "agent",
    text: result.reply,
    sequence_no: sequenceNo++,
  });

  // runAgentTurn cannot know database ids, so it emits every event with id 0.
  // Read the assigned ids back rather than returning the placeholders — the
  // activity rail and replay both identify events by id.
  let toolEvents = result.toolEvents;
  if (toolEvents.length > 0) {
    const { data: inserted } = await supabase
      .from("agent_events")
      .insert(
        toolEvents.map((event) => ({
          session_id: sessionId,
          event_type: event.eventType,
          tool_name: event.toolName,
          title: event.title,
          payload: event.payload,
          sequence_no: sequenceNo++,
        }))
      )
      .select("id, sequence_no");

    if (inserted?.length === toolEvents.length) {
      toolEvents = toolEvents.map((event, index) => ({
        ...event,
        id: inserted[index].id,
        sequenceNo: inserted[index].sequence_no,
      }));
    }
  }

  await supabase
    .from("demo_sessions")
    .update({ status: result.nextState })
    .eq("id", sessionId);

  if (result.draftPatch) {
    const { error: draftError } = await supabase.from("clinical_drafts").upsert(
      {
        session_id: sessionId,
        chief_concern: result.draftPatch.chiefConcern ?? draft.chiefConcern,
        hpi: result.draftPatch.historyOfPresentIllness ?? draft.historyOfPresentIllness,
        timeline: result.draftPatch.timeline ?? draft.timeline,
        red_flags: result.draftPatch.safetyFlags ?? draft.safetyFlags,
        key_connection: result.draftPatch.keyConnection ?? draft.keyConnection,
        unresolved_questions: result.draftPatch.unresolvedQuestions ?? draft.unresolvedQuestions,
        assessment_support: result.draftPatch.clinicianReviewNotes ?? draft.clinicianReviewNotes,
        patient_summary: result.draftPatch.patientFriendlySummary ?? draft.patientFriendlySummary,
        coverage_summary: result.draftPatch.coverageSummary ?? draft.coverageSummary,
      },
      { onConflict: "session_id" }
    );

    // The turn still succeeds — the agent reply matters more than the write
    // during a live demo — but a dropped draft must never be silent. A missing
    // column here means a migration has not been applied to this database.
    if (draftError) {
      console.error("[agent/turn] clinical_drafts upsert failed", {
        sessionId,
        code: draftError.code,
        message: draftError.message,
      });
    }
  }

  return NextResponse.json({
    reply: result.reply,
    nextState: result.nextState,
    toolEvents,
  });
}
