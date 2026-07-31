import type { SafetyFlag } from "@/types";

// Hard-coded red-flag checklist for the rash demo (doc section 7). The LLM
// never decides whether a flag can be ignored — this stays deterministic.
export const SAFETY_RED_FLAGS = [
  "breathing difficulty",
  "facial or mouth swelling",
  "fever",
  "mucosal sores",
  "blistering",
  "rapid spread",
  "severe pain",
] as const;

export const ESCALATION_MESSAGE =
  "This may need urgent clinical attention. Please contact your care team or emergency services now. I'm pausing the pre-visit intake.";

export function checkSafetyRedFlags(
  utterance: string,
  priorFlags: SafetyFlag[] = []
): SafetyFlag[] {
  const text = utterance.toLowerCase();
  const detected = new Map(priorFlags.map((f) => [f.name, f.status]));

  for (const name of SAFETY_RED_FLAGS) {
    if (detected.get(name) === "present") continue;
    detected.set(name, text.includes(name) ? "present" : detected.get(name) ?? "unknown");
  }

  return SAFETY_RED_FLAGS.map((name) => ({
    name,
    status: detected.get(name) ?? "unknown",
  }));
}

export function hasActiveRedFlag(flags: SafetyFlag[]): boolean {
  return flags.some((f) => f.status === "present");
}
