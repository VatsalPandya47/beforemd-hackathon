import { checkSafetyRedFlags, ESCALATION_MESSAGE, hasActiveRedFlag } from "@/lib/agent/safety";
import { getPatientContext } from "@/lib/integrations/medplum";
import { retrieve } from "@/lib/integrations/moss";
import { checkEligibility } from "@/lib/integrations/stedi";
import { demoIds } from "@/lib/flags";
import type { AgentEvent, AgentState, AgentTurnResult, ClinicalDraft } from "@/types";

// Deterministic state machine from doc section 7:
// CONSENT -> LOAD_HISTORY -> OPENING_QUESTION -> IDENTIFY_GAP ->
// ASK_ADAPTIVE_QUESTION -> SAFETY_SCREEN -> RETRIEVE_SUPPORTING_CONTEXT ->
// BUILD_TIMELINE -> CHECK_ELIGIBILITY -> GENERATE_DRAFT ->
// PATIENT_CONFIRMATION -> CLINICIAN_REVIEW_READY
//
// Deliberately deterministic after the first two questions (doc section 3) —
// the LLM chooses wording, never the next state. Wire the actual LLM call in
// nextQuestionForGap once LLM_API_KEY is available; until then this returns
// scripted copy matching the doc's demo conversation.

const STATE_ORDER: AgentState[] = [
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

export async function runAgentTurn(
  sessionId: string,
  patientFhirId: string,
  currentState: AgentState,
  utterance: string,
  draft: ClinicalDraft
): Promise<AgentTurnResult> {
  const toolEvents: AgentEvent[] = [];
  let sequenceNo = 0;
  const emit = (
    eventType: AgentEvent["eventType"],
    toolName: string,
    title: string,
    payload?: Record<string, unknown>
  ) => toolEvents.push(toolEvent(sessionId, sequenceNo++, eventType, toolName, title, payload));

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
      return {
        reply: "What would you most like your doctor to understand today?",
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
      return {
        reply: "Did the rash begin before or after you started lamotrigine?",
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: { safetyFlags },
      };
    }

    case "SAFETY_SCREEN": {
      emit("tool_started", "check_safety_red_flags", "Checking for urgent warning signs");
      const safetyFlags = checkSafetyRedFlags(utterance, draft.safetyFlags);
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
        payerId: "DEMO_PAYER",
        memberId: "DEMO_MEMBER",
        serviceType: "30",
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

    case "GENERATE_DRAFT":
      emit("tool_started", "create_clinician_draft", "Preparing the clinician review");
      emit("tool_completed", "create_clinician_draft", "Prepared the clinician review");
      return {
        reply: "I've prepared a draft for your clinician to review.",
        nextState: nextState(currentState),
        toolEvents,
        draftPatch: null,
      };

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
