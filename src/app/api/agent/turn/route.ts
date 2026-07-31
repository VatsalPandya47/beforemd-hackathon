import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { demoClinicalDraft } from "@/lib/demo-fixtures";
import type { AgentState, ClinicalDraft } from "@/types";

const AgentTurnSchema = z.object({
  sessionId: z.string().uuid(),
  utterance: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const parsed = AgentTurnSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sessionId, utterance } = parsed.data;

  const supabase = createAdminClient();

  const { data: session, error: sessionError } = await supabase
    .from("demo_sessions")
    .select("id, patient_fhir_id, status")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
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
        keyConnection: null,
        unresolvedQuestions: draftRow.unresolved_questions ?? [],
        clinicianReviewNotes: draftRow.assessment_support ?? [],
        patientFriendlySummary: draftRow.patient_summary ?? "",
        coverageSummary: draftRow.coverage_summary ?? null,
        clinicianStatus: draftRow.clinician_status ?? "draft",
      }
    : { ...demoClinicalDraft, sessionId };

  const { data: lastEvent } = await supabase
    .from("transcript_events")
    .select("sequence_no")
    .eq("session_id", sessionId)
    .order("sequence_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  let sequenceNo = (lastEvent?.sequence_no ?? -1) + 1;

  await supabase.from("transcript_events").insert({
    session_id: sessionId,
    speaker: "patient",
    text: utterance,
    sequence_no: sequenceNo++,
  });

  const currentState = (session.status as AgentState) ?? "CONSENT";
  const result = await runAgentTurn(
    sessionId,
    session.patient_fhir_id,
    currentState,
    utterance,
    draft
  );

  await supabase.from("transcript_events").insert({
    session_id: sessionId,
    speaker: "agent",
    text: result.reply,
    sequence_no: sequenceNo++,
  });

  if (result.toolEvents.length > 0) {
    await supabase.from("agent_events").insert(
      result.toolEvents.map((event) => ({
        session_id: sessionId,
        event_type: event.eventType,
        tool_name: event.toolName,
        title: event.title,
        payload: event.payload,
        sequence_no: sequenceNo++,
      }))
    );
  }

  await supabase
    .from("demo_sessions")
    .update({ status: result.nextState })
    .eq("id", sessionId);

  if (result.draftPatch) {
    await supabase.from("clinical_drafts").upsert(
      {
        session_id: sessionId,
        chief_concern: result.draftPatch.chiefConcern ?? draft.chiefConcern,
        hpi: result.draftPatch.historyOfPresentIllness ?? draft.historyOfPresentIllness,
        timeline: result.draftPatch.timeline ?? draft.timeline,
        red_flags: result.draftPatch.safetyFlags ?? draft.safetyFlags,
        unresolved_questions: result.draftPatch.unresolvedQuestions ?? draft.unresolvedQuestions,
        assessment_support: result.draftPatch.clinicianReviewNotes ?? draft.clinicianReviewNotes,
        patient_summary: result.draftPatch.patientFriendlySummary ?? draft.patientFriendlySummary,
        coverage_summary: result.draftPatch.coverageSummary ?? draft.coverageSummary,
      },
      { onConflict: "session_id" }
    );
  }

  return NextResponse.json({
    reply: result.reply,
    nextState: result.nextState,
    toolEvents: result.toolEvents,
  });
}
