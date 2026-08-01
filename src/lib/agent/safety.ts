import type { SafetyFlag, SafetyFlagStatus } from "@/types";

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

export type SafetyRedFlag = (typeof SAFETY_RED_FLAGS)[number];

export const ESCALATION_MESSAGE =
  "This may need urgent clinical attention. Please contact your care team or emergency services now. I'm pausing the pre-visit intake.";

// Patients describe symptoms, they do not recite a checklist. Matching the flag
// names as substrings meant "I'm having trouble breathing" scored no flags
// while only a verbatim "breathing difficulty" did. Each flag therefore carries
// the phrasings people actually use.
//
// Patterns run against normalized text (lowercased, apostrophes stripped, so
// "can't" is "cant"). Where the symptom is expressed with a negative verb
// ("cant breathe"), the pattern must span that verb — otherwise the negation
// check below reads it as a denial.
const RED_FLAG_PATTERNS: Record<SafetyRedFlag, RegExp[]> = {
  "breathing difficulty": [
    /\b(trouble|difficulty|hard|struggling|problems?)\b[^,.;]{0,15}\bbreath(e|ing)\b/,
    /\bbreathing\b[^,.;]{0,15}\b(difficult|hard|problems?)\b/,
    /\b(cant|cannot|couldnt|unable to)\b[^,.;]{0,10}\bbreathe?\b/,
    /\bshort(ness)? of breath\b/,
    /\bwheez\w+\b/,
    /\bgasping\b/,
    /\bchest (is )?tight\b/,
  ],
  // "swollen" is not a prefix of "swell", so it needs listing separately.
  "facial or mouth swelling": [
    /\b(face|facial|lips?|tongue|throat|mouth|eyes?)\b[^,.;]{0,20}\b(swell\w*|swollen|puffy)\b/,
    /\b(swell\w*|swollen|puffy)\b[^,.;]{0,20}\b(face|facial|lips?|tongue|throat|mouth|eyes?)\b/,
    /\bangioedema\b/,
    /\bthroat (is )?closing\b/,
  ],
  fever: [/\bfevers?\b/, /\bfebrile\b/, /\btemperature\b/, /\bchills\b/, /\bshivering\b/],
  "mucosal sores": [
    /\bmucosal\b[^,.;]{0,15}\b(sores?|ulcers?|lesions?)\b/,
    /\b(mouth|oral|lips?|tongue|throat|genital|eyes?)\b[^,.;]{0,20}\b(sores?|ulcers?|blisters?|lesions?)\b/,
    /\b(sores?|ulcers?|blisters?)\b[^,.;]{0,20}\b(in|on|inside)\b[^,.;]{0,15}\b(mouth|lips?|tongue|throat|eyes?)\b/,
    /\bcanker sores?\b/,
  ],
  blistering: [/\bblister\w*\b/, /\bbullae\b/, /\bskin (is )?peeling\b/, /\bpeeling skin\b/],
  "rapid spread": [
    /\bspread\w*\b[^,.;]{0,15}\b(fast|quick\w*|rapid\w*)\b/,
    /\b(fast|quick\w*|rapid\w*)\w*\b[^,.;]{0,15}\bspread\w*\b/,
    /\bspreading (all over|everywhere)\b/,
    /\bgetting worse\b[^,.;]{0,15}\b(fast|quick\w*|rapid\w*)\b/,
  ],
  "severe pain": [
    /\bsevere\b[^,.;]{0,15}\bpain\w*\b/,
    /\bpain\w*\b[^,.;]{0,15}\b(severe|unbearable|excruciating|intense|terrible|awful|worst)\b/,
    /\b(unbearable|excruciating)\b/,
    /\bworst pain\b/,
    /\b(10|ten) out of (10|ten)\b/,
  ],
};

// Cues that flip a mention into a denial. Scoped to the clause containing the
// match, so "no fever, but blistering started" denies only the fever.
const NEGATION_CUE =
  /\b(no|not|none|never|without|dont|doesnt|didnt|havent|hasnt|isnt|arent|wasnt|werent|cant|deny|denies|denied|negative|free of)\b/;

// A plain "no" to the compound safety question denies every flag at once.
// Deliberately narrow: the utterance must open with a denial and contain
// nothing but denial and filler words, so "no trouble breathing" (a specific
// answer) and "no fever but blistering" (a mixed one) both fall through to the
// per-flag scan instead.
const DENIAL_OPENER = /^(no|nope|nah|none|negative|nothing)\b/;
const DENIAL_FILLER =
  /^(no|nope|nah|none|negative|nothing|not|i|im|am|dont|do|have|having|any|of|those|them|that|the|at|all|like|really|sorry|thanks|thank|you|none)$/;

function normalize(utterance: string): string {
  return utterance.toLowerCase().replace(/['’]/g, "");
}

// Text that can sit between two symptoms and still be one negated list:
// "no fever or blistering", "no fever, swelling, or sores". Anything with a
// real word in it ends the denial's reach.
const LIST_GLUE = /^[\s,]*(or|nor|and)?[\s,]*$/;

type SymptomHit = { flag: SafetyRedFlag; start: number; end: number };

function findHits(text: string): SymptomHit[] {
  const hits: SymptomHit[] = [];
  for (const flag of SAFETY_RED_FLAGS) {
    for (const pattern of RED_FLAG_PATTERNS[flag]) {
      const scanner = new RegExp(pattern.source, "g");
      let match: RegExpExecArray | null;
      while ((match = scanner.exec(text)) !== null) {
        hits.push({ flag, start: match.index, end: match.index + match[0].length });
        if (match[0].length === 0) scanner.lastIndex++;
      }
    }
  }
  return hits.sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Decide present/absent per symptom mentioned in one utterance.
 *
 * A denial binds to the *next* symptom mentioned and is spent there, rather
 * than covering everything up to the next punctuation mark. Scoping by
 * punctuation meant any connector we had not enumerated let an earlier denial
 * swallow a later, real symptom: "no fever um Im having trouble breathing"
 * scored breathing as absent. That matters because the input is Deepgram
 * transcription, which frequently arrives with no punctuation at all.
 *
 * A denial carries past a symptom only when nothing but list glue separates
 * them, so "no fever or blistering" denies both while "no fever my face is
 * swelling" denies only the fever.
 *
 * A cue sitting at the very start of a match is part of the symptom, not a
 * denial of it — "cant breathe" is a report, not a denial of breathing.
 */
function scoreHits(text: string): Map<SafetyRedFlag, SafetyFlagStatus> {
  const cueScanner = new RegExp(NEGATION_CUE.source, "g");
  const cueIndices: number[] = [];
  let cue: RegExpExecArray | null;
  while ((cue = cueScanner.exec(text)) !== null) cueIndices.push(cue.index);

  const scored = new Map<SafetyRedFlag, SafetyFlagStatus>();
  let previousEnd = 0;
  let denialCarries: boolean = false;

  for (const hit of findHits(text)) {
    // Overlapping matches of the same phrase — already accounted for.
    if (hit.start < previousEnd) continue;

    const gap = text.slice(previousEnd, hit.start);
    const cueInGap = cueIndices.some((index) => index >= previousEnd && index < hit.start);
    const negated: boolean = cueInGap || (denialCarries && LIST_GLUE.test(gap));

    // A reported symptom outranks a denial of the same one elsewhere.
    if (scored.get(hit.flag) !== "present") {
      scored.set(hit.flag, negated ? "absent" : "present");
    }

    denialCarries = negated;
    previousEnd = hit.end;
  }

  return scored;
}

/**
 * A bare "no" answering the compound safety question. Callers should only
 * honour this in SAFETY_SCREEN, where the question that was just asked is
 * known — a "no" anywhere else denies nothing in particular.
 */
export function isBlanketDenial(utterance: string): boolean {
  const words = normalize(utterance)
    .replace(/[.,!?;:]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0 || !DENIAL_OPENER.test(words[0])) return false;
  return words.every((word) => DENIAL_FILLER.test(word));
}

export function checkSafetyRedFlags(
  utterance: string,
  priorFlags: SafetyFlag[] = []
): SafetyFlag[] {
  const text = normalize(utterance);
  const prior = new Map(priorFlags.map((flag) => [flag.name, flag.status]));
  const scored = scoreHits(text);

  return SAFETY_RED_FLAGS.map((name) => {
    const previous = prior.get(name) ?? "unknown";

    // A red flag once reported stays reported. Only a clinician clears it.
    if (previous === "present") return { name, status: "present" as SafetyFlagStatus };

    return { name, status: scored.get(name) ?? previous };
  });
}

/** Every flag the patient has not spoken to yet, marked absent by an explicit "no". */
export function applyBlanketDenial(flags: SafetyFlag[]): SafetyFlag[] {
  return flags.map((flag) =>
    flag.status === "unknown" ? { ...flag, status: "absent" as SafetyFlagStatus } : flag
  );
}

/** Nothing screened yet. A fresh session must not inherit "absent" from a fixture. */
export function initialSafetyFlags(): SafetyFlag[] {
  return SAFETY_RED_FLAGS.map((name) => ({ name, status: "unknown" as SafetyFlagStatus }));
}

export function hasActiveRedFlag(flags: SafetyFlag[]): boolean {
  return flags.some((flag) => flag.status === "present");
}
