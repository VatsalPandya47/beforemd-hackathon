# Three-minute pitch

**Status: draft — needs a live timed read-through before it's locked.** Read it out loud with a stopwatch; adjust wording to hit each bucket, not just the total.

Target: under 3:00, with roughly 15 seconds of buffer. Q&A prep lives in [`docs/sponsor-notes.md`](sponsor-notes.md).

## Script

**0:00–0:20 — Problem**
> Doctors spend the beginning of every visit reconstructing a story that already exists — scattered across conversations, medications, notes, and insurance systems.

**0:20–0:35 — Product**
> BeforeMD is a voice-first pre-visit agent. It asks the missing questions, charts the conversation, connects the patient's longitudinal history, and prepares a sourced draft before the doctor ever walks in.

**0:35–1:45 — Live demo** (70 seconds — the bulk of the pitch)
> Run Maya's conversation live. Show, in order: the adaptive question about lamotrigine timing, the medication-rash timeline reveal, the Stedi coverage check, and the clinician brief.

Demo beats to hit (see `docs/demo-script.md` for the full scripted conversation):
1. Start the session from the clinician dashboard.
2. Maya mentions the rash and the recent medication change.
3. Agent asks the adaptive question — did the rash start before or after lamotrigine.
4. Timeline reveal: the 11-day correlation animates on screen.
5. Coverage card appears with active/in-network/copay.
6. Clinician brief: draft, sources, unresolved questions, Approve button.

**1:45–2:10 — Technology**
> Deepgram powers the voice experience. Medplum is the FHIR source of truth. Moss retrieves relevant context. Stedi explains coverage and benefits. Supabase coordinates live application state.

**2:10–2:30 — Safety**
> BeforeMD doesn't diagnose or prescribe. It separates what the patient said from what the chart says, shows its sources, screens for red flags, and keeps the clinician in control.

**2:30–3:00 — Vision**
> The doctor's visit of the future doesn't start when the doctor walks in — it starts when the patient starts speaking. We're building the intelligence layer that prepares every medical encounter before it happens.

## Rehearsal checklist

- [ ] Read the full script out loud, timed, at least twice
- [ ] Confirm the live demo actually produces the beats listed above (re-check after each of #7, #11, #15 land — Medplum seed, LLM wiring, live voice)
- [ ] Have the backup demo video ready in case the live run breaks (see #4, #5)
- [ ] Know the fallback: if timing runs long, skip the patient summary screen and jump straight to the clinician brief (`docs/demo-script.md` fallback ladder)
- [ ] Walk the judge-specific talking points and likely Q&A in `docs/sponsor-notes.md` so answers are ready, not improvised
