import {
  applyBlanketDenial,
  checkSafetyRedFlags,
  ESCALATION_MESSAGE,
  hasActiveRedFlag,
  isBlanketDenial,
} from "@/lib/agent/safety";
import { generateDraft, generateQuestion } from "@/lib/agent/llm";
import { getPatientContext } from "@/lib/integrations/medplum";
import { retrieve } from "@/lib/integrations/moss";
import { checkEligibility, STEDI_DEMO_REQUEST } from "@/lib/integrations/stedi";
import { demoIds } from "@/lib/flags";
import type {
  AgentEvent,
  AgentState,
  AgentTurnResult,
  ClinicalDraft,
  PatientContext,
  TranscriptEvent,
} from "@/types";

// Deterministic state machine from doc section 7:
// CONSENT -> LOAD_HISTORY -> OPENING_QUESTION -> IDENTIFY_GAP ->
// ASK_ADAPTIVE_QUESTION -> SAFETY_SCREEN -> RETRIEVE_SUPPORTING_CONTEXT ->
// BUILD_TIMELINE -> CHECK_ELIGIBILITY -> GENERATE_DRAFT ->
// PATIENT_CONFIRMATION -> CLINICIAN_REVIEW_READY
//
// Deliberately deterministic after the first two questions (doc section 3).
// The LLM (lib/agent/llm.ts) only rephrases the question this state machine has
// already chosen, and fills the structured draft. It never picks the next
// state. Consent, escalation, and the "no diagnosis" disclaimer stay verbatim
// below — the model never generates safety or consent copy.
//
// SCRIPTED_QUESTIONS are the intents handed to the LLM and the fallback spoken
// aloud whenever the model errors, times out, or overruns the word cap.

export const STATE_ORDER: AgentState[] = [
  "CONSENT",
  "LOAD_HISTORY",
  "OPENING_QUESTION",
  "IDENTIFY_GAP",
  "ASK_ADAPTIVE_QUESTION",
  "SAFETY_SCREEN",
  "RETRIEVE_SUPPORTING_CONTEXT",
  "BUILD_TIMELINE",
  "CHECK_ELIGIBILITY",
  "GENERATE_DRAFT",
  "PATIENT_CONFIRMATION",
  "CLINICIAN_REVIEW_READY",
];

function nextState(current: AgentState): AgentState {
  const index = STATE_ORDER.indexOf(current);
  return STATE_ORDER[Math.min(index + 1, STATE_ORDER.length - 1)];
}

function toolEvent(
  sessionId: string,
  sequenceNo: number,
  eventType: AgentEvent["eventType"],
  toolName: string,
  title: string,
  payload: Record<string, unknown> = {}
): AgentEvent {
  return {
    id: 0,
    sessionId,
    eventType,
    toolName,
    title,
    payload,
    sequenceNo,
    createdAt: new Date().toISOString(),
  };
}

// One distinct intent per state, following the scripted conversation in doc
// section 2. These three states previously shared a single hard-coded question,
// which asked the patient the same thing three turns in a row.
const SCRIPTED_QUESTIONS = {
  opening: "What would you most like your doctor to understand today?",
  OPENING_QUESTION:
    "I can see lamotrigine was started five weeks ago. Did the rash begin before or after you started it?",
  IDENTIFY_GAP: "Did it improve when you stopped or paused the medication?",
  ASK_ADAPTIVE_QUESTION:
    "Are you having trouble breathing, swelling of the face or mouth, fever, or sores in your mouth?",
} as const;

// What each step needs to establish. The model decides what to actually ask in
// service of the goal, so it can follow the patient instead of a script — a
// patient reporting a sore throat was previously asked whether their rash
// predated lamotrigine, because the question text was fixed to the demo story.
// SCRIPTED_QUESTIONS above are now the fallback for these steps, not the plan.
const QUESTION_GOALS: Partial<Record<AgentState, string>> = {
  LOAD_HISTORY:
    "Open the intake. Find out, in their own words, what the patient most wants their clinician to understand today.",
  OPENING_QUESTION:
    "Establish the timing and course of the concern they just raised — when it started, and whether anything in their history lines up with it.",
  IDENTIFY_GAP:
    "Find the missing detail that would most change how a clinician reads this: what makes it better or worse, whether it has happened before, or what they have already tried.",
};

// Which steps get to ask a model-generated question. ASK_ADAPTIVE_QUESTION is
// deliberately excluded: that step asks the compound red-flag question, and its
// wording enumerates the specific symptoms the deterministic screen looks for.
// A model rephrasing it could quietly drop one, so it stays verbatim.
//
// Cost: three question calls plus the draft. The AI Gateway free tier throttles
// after roughly 3-5 (issue #47), so on a spent bucket some turns fall back to
// the scripted line — which is exactly the old behaviour, no worse. Credits
// remove the ceiling.
const LLM_QUESTION_STATES = new Set<AgentState>([
  "LOAD_HISTORY",
  "OPENING_QUESTION",
  "IDENTIFY_GAP",
]);

export async function runAgentTurn(
  sessionId: string,
  patientFhirId: string,
  currentState: AgentState,
  utterance: string,
  draft: ClinicalDraft,
  transcript: TranscriptEvent[] = []
): Promise<AgentTurnResult> {
  const toolEvents: AgentEvent[] = [];
  let sequenceNo = 0;
  const emit = (
    eventType: AgentEvent["eventType"],
    toolName: string,
    title: string,
    payload?: Record<string, unknown>
  ) => toolEvents.push(toolEvent(sessionId, sequenceNo++, eventType, toolName, title, payload));

  // Chart context grounds the model so it can only reference real FHIR facts.
  // Adapter-level fixture fallback means this stays cheap when Medplum is off.
  const loadContext = async (): Promise<PatientContext | null> => {
    const result = await getPatientContext(patientFhirId);
    return result.data ?? null;
  };

  switch (currentState) {
    case "CONSENT":
      return {
        reply:
          "Hi. I'm BeforeMD, the pre-visit assistant for your care team. I'll ask a few questions and prepare a draft for your clinician to review. Is that okay?",
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: null,
      };

    case "LOAD_HISTORY": {
      emit("tool_started", "get_patient_context", "Reviewing medication and visit history");
      const context = await getPatientContext(patientFhirId);
      emit("tool_completed", "get_patient_context", "Reviewed medication and visit history", {
        source: context.source,
      });
      const opening = LLM_QUESTION_STATES.has(currentState)
        ? await generateQuestion({
            goal: QUESTION_GOALS.LOAD_HISTORY ?? "",
            fallback: SCRIPTED_QUESTIONS.opening,
            utterance,
            patientContext: context.data ?? null,
            transcript,
          })
        : { text: SCRIPTED_QUESTIONS.opening, source: "fixture" as const };
      return {
        reply: opening.text,
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: context.data
          ? { chiefConcern: draft.chiefConcern }
          : null,
      };
    }

    case "OPENING_QUESTION":
    case "IDENTIFY_GAP":
    case "ASK_ADAPTIVE_QUESTION": {
      // Deterministic screen runs before any model call, and its escalation
      // copy is returned verbatim — the LLM never sees a red-flag turn.
      const safetyFlags = checkSafetyRedFlags(utterance, draft.safetyFlags);
      if (hasActiveRedFlag(safetyFlags)) {
        emit("safety_flag", "check_safety_red_flags", "Urgent red flag detected", {
          flags: safetyFlags,
        });
        return {
          reply: ESCALATION_MESSAGE,
          nextState: "SAFETY_SCREEN",
          toolEvents,
          draftPatch: { safetyFlags },
        };
      }
      const question = LLM_QUESTION_STATES.has(currentState)
        ? await generateQuestion({
            goal: QUESTION_GOALS[currentState] ?? "",
            fallback: SCRIPTED_QUESTIONS[currentState],
            utterance,
            patientContext: await loadContext(),
            transcript,
          })
        : { text: SCRIPTED_QUESTIONS[currentState], source: "fixture" as const };
      return {
        reply: question.text,
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: { safetyFlags },
      };
    }

    case "SAFETY_SCREEN": {
      emit("tool_started", "check_safety_red_flags", "Checking for urgent warning signs");
      const screened = checkSafetyRedFlags(utterance, draft.safetyFlags);
      // This state asks one compound question covering every flag, so a plain
      // "no" here denies all of them. Only valid in this state — a "no"
      // elsewhere is answering something else.
      // Never let a denial blank out flags in the same breath as a reported
      // symptom — if anything scored present, take the scan as-is.
      const safetyFlags =
        isBlanketDenial(utterance) && !hasActiveRedFlag(screened)
          ? applyBlanketDenial(screened)
          : screened;

      // The escalation branch belongs here too, not only in the question
      // states: a patient can first report a red flag when directly asked.
      if (hasActiveRedFlag(safetyFlags)) {
        emit("safety_flag", "check_safety_red_flags", "Urgent red flag detected", {
          flags: safetyFlags,
        });
        return {
          reply: ESCALATION_MESSAGE,
          nextState: "SAFETY_SCREEN",
          toolEvents,
          draftPatch: { safetyFlags },
        };
      }

      emit("tool_completed", "check_safety_red_flags", "Checked for urgent warning signs", {
        flags: safetyFlags,
      });
      return {
        reply: "Thank you. I'll flag the timing and document your answers.",
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: { safetyFlags },
      };
    }

    case "RETRIEVE_SUPPORTING_CONTEXT": {
      emit("tool_started", "retrieve_relevant_context", "Finding the most relevant prior context");
      const context = await retrieve(utterance, patientFhirId);
      emit("tool_completed", "retrieve_relevant_context", "Found relevant prior context", {
        source: context.source,
        count: context.data?.length ?? 0,
      });
      return {
        reply: "I'll also check your coverage for the visit.",
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: null,
      };
    }

    case "BUILD_TIMELINE": {
      emit("tool_started", "build_timeline", "Connecting symptoms to the longitudinal timeline");
      emit("tool_completed", "build_timeline", "Connected symptoms to the longitudinal timeline");
      return {
        reply: "I found a timing connection worth flagging for your clinician.",
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: null,
      };
    }

    case "CHECK_ELIGIBILITY": {
      emit("tool_started", "check_eligibility", "Checking insurance benefits");
      const coverage = await checkEligibility({
        patientFhirId,
        ...STEDI_DEMO_REQUEST,
      });
      emit("tool_completed", "check_eligibility", "Checked insurance benefits", {
        source: coverage.source,
      });
      return {
        reply: "Your coverage looks active for this visit.",
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: { coverageSummary: coverage.data ?? null },
      };
    }

    case "GENERATE_DRAFT": {
      emit("tool_started", "create_clinician_draft", "Preparing the clinician review");
      const generated = await generateDraft({
        patientContext: await loadContext(),
        transcript,
        currentDraft: draft,
      });
      emit("tool_completed", "create_clinician_draft", "Prepared the clinician review", {
        source: generated.source,
      });

      // Safety flags come from the deterministic screen, never the model.
      const safetyFlags = checkSafetyRedFlags(utterance, draft.safetyFlags);

      if (generated.draft.keyConnection) {
        emit("insight", "build_timeline", generated.draft.keyConnection.statement, {
          confidence: generated.draft.keyConnection.confidence,
          evidenceSourceIds: generated.draft.keyConnection.evidenceSourceIds,
        });
      }

      return {
        reply: "I've prepared a draft for your clinician to review.",
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: {
          chiefConcern: generated.draft.chiefConcern,
          historyOfPresentIllness: generated.draft.historyOfPresentIllness,
          timeline: generated.draft.timeline,
          keyConnection: generated.draft.keyConnection,
          unresolvedQuestions: generated.draft.unresolvedQuestions,
          clinicianReviewNotes: generated.draft.clinicianReviewNotes,
          patientFriendlySummary: generated.draft.patientFriendlySummary,
          safetyFlags,
        },
      };
    }

    case "PATIENT_CONFIRMATION":
      return {
        reply:
          "Your clinician will review this draft before your visit. No diagnosis or treatment decision has been made.",
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: null,
      };

    case "CLINICIAN_REVIEW_READY":
    default:
      return {
        reply: "This session is ready for clinician review.",
        nextState: "CLINICIAN_REVIEW_READY",
        toolEvents,
        draftPatch: null,
      };
  }
}

export function demoAppointmentId(): string {
  return demoIds.appointmentFhirId;
}
