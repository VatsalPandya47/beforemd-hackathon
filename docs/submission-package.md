# Submission package

**Status: draft.** URLs and copy are ready. Video and final team contact info are still open — see checklist at the bottom.

## Links

- **Production URL:** https://beforemd-hackathon.vercel.app
- **GitHub repository:** https://github.com/VatsalPandya47/beforemd-hackathon

## One-sentence description

BeforeMD is a voice-first pre-visit agent that understands a patient's longitudinal history, asks the missing questions, and prepares a sourced clinical brief before the doctor enters the room.

## Problem, solution, sponsor usage

Doctors spend the beginning of every visit reconstructing a story that already exists — scattered across notes, medications, labs, patient memory, and insurance systems. Fixed intake forms don't adapt to prior history, and documentation starts after the conversation, not during it.

BeforeMD runs a voice-first pre-visit conversation that adapts to the patient's actual chart. It retrieves longitudinal history from **Medplum** (the FHIR source of truth for patient, encounter, medication, and document records), streams the conversation through **Deepgram**, pulls relevant supporting context through **Moss**, checks insurance coverage through **Stedi**, and coordinates live session state through **Supabase** (transcripts, tool events, and the generated clinical draft, realtime-synced to the clinician's screen). The result is a structured, sourced pre-visit note and clinician brief — not a diagnosis — with every timeline claim traceable back to a specific FHIR resource.

## Synthetic-data and clinician-review disclaimer

All demo data is synthetic — no real patients, records, or identifiers. BeforeMD does not diagnose, prescribe, or represent that a clinician has approved any output. Every generated draft is explicitly labeled unverified until a clinician takes the separate, explicit Approve action.

## Screenshots

See `docs/screenshots/` — `voice-intake.png`, `timeline-reveal.png`, `clinician-brief.png`.

## Team

| Name | Role | Contact |
| --- | --- | --- |
| Vatsal | Product, pitch, sponsor relations | admin@tasksmind.com |
| Kashish | FHIR and Medplum | _fill in_ |
| Chiradeep | Agent orchestration and integrations | _fill in_ |
| Thang | Frontend, voice UX, visualization | _fill in_ |

## Outstanding before submission

- [ ] 90-second backup demo video (needs a full rehearsed run — see `docs/pitch.md`)
- [ ] Kashish, Chiradeep, and Thang's contact info for the team table above
- [ ] Re-take screenshots once real Medplum data (#7) and live voice (#15) are wired in, so they show the real demo instead of fixture data
- [ ] Submit at least 20 minutes before the deadline
