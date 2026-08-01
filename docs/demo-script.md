# Demo script

**Status: locked.** Patient story, numbers, and canonical dialogue below are confirmed — this is what we rehearse and pitch from.

**Implementation note:** the agent's actual spoken lines today (`src/lib/agent/orchestrator.ts`) are deterministic placeholders, not this exact script — they're missing the "lamotrigine was started five weeks ago" context line and never actually voice the safety-screen question out loud (the red-flag check currently just scans whatever the patient last typed/said for keywords, silently). Once #11 (wire a real LLM into the orchestrator) lands, the live dialogue should match this script. Until then, treat this file as the target, and rehearse against the current live wording separately so nobody's surprised on stage.

## Synthetic patient

| Field | Demo value |
| --- | --- |
| Name | Maya Thompson |
| Age | 29 |
| Primary concern | Recurring itchy rash on arms and torso |
| Relevant history | Started lamotrigine 5 weeks ago; rash appeared 11 days later |
| Prior care | Topical steroid improved symptoms temporarily |
| Current issue | Rash returned after medication was resumed |
| Insurance | Active PPO plan; dermatology visit in network |

Synthetic demo only. Clinician review required. No real patient data.

## Demonstration flow

1. Open Maya's upcoming appointment from the clinician dashboard.
2. Start the pre-visit voice session. Maya says the rash keeps returning and wonders whether it relates to a new medication.
3. Deepgram streams the transcript and detects natural turns.
4. BeforeMD retrieves Maya's medication history, prior visit note, allergy list, and timeline from Medplum.
5. The agent asks an adaptive follow-up: "Did the rash begin before or after you started lamotrigine?"
6. Maya answers that it began about a week and a half later and returned after she restarted the medication.
7. The interface highlights the timeline correlation and shows the evidence used.
8. The system generates a structured pre-visit note and clinician brief, not a final diagnosis.
9. Stedi returns active coverage, in-network status, and a test copay estimate.
10. The clinician review screen shows the draft, sources, unresolved questions, and an Approve button.
11. End with the patient-friendly view explaining what the doctor will review and the expected cost.

## The "wow" moment

> "The symptoms first appeared 11 days after the medication was started and returned after it was resumed."

The screen animates the two events on a timeline and links each point to the underlying Medplum record.

## Scripted patient conversation

> **AGENT:** Hi Maya. I'm BeforeMD, the pre-visit assistant for your care team. I'll ask a few questions and prepare a draft for your clinician to review. Is that okay?
> **PATIENT:** Yes.
> **AGENT:** What would you most like your doctor to understand today?
> **PATIENT:** This rash keeps coming back. I changed medication recently, but I don't know if that is connected.
> **AGENT:** I can see lamotrigine was started five weeks ago. Did the rash begin before or after you started it?
> **PATIENT:** After. Maybe a week and a half later.
> **AGENT:** Did it improve when you stopped or paused the medication?
> **PATIENT:** It got better with the cream, then came back after I started the medication again.
> **AGENT:** Are you having trouble breathing, swelling of the face or mouth, fever, or sores in your mouth?
> **PATIENT:** No.
> **AGENT:** Thank you. I'll flag the timing, document your answers, and prepare this for your clinician. I'll also check your coverage for the visit.

This script is hard-coded into `src/lib/demo-fixtures.ts` (`demoClinicalDraft`) as the fixture/replay fallback if the live voice or LLM path fails mid-demo.

## Fallback ladder

| Failure | Immediate fallback |
| --- | --- |
| Microphone permission fails | Play committed backup WAV through replay mode |
| Deepgram connection fails | Stream prerecorded transcript events from Supabase fixture (`/api/demo/replay`) |
| Moss credentials unavailable | Use retrieved-context fixture through the same adapter |
| Stedi call fails | Use cached successful test-mode response, labeled "cached test response" |
| Medplum write fails | Show preloaded patient context and queue the draft locally |
| LLM output is malformed | Use deterministic demo draft fixture after one retry |
| Vercel deployment issue | Use last stable preview deployment |
| Live demo timing runs long | Skip patient summary and jump to clinician brief |

## Freeze rules

- At 4:15 PM, no new features.
- At 4:30 PM, no dependency upgrades.
- After submission, only pitch copy changes are allowed.
- Keep the last stable deployment URL and commit hash written in the team chat.
