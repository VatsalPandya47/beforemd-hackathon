# Architecture

## Stack

| Layer | Technology | Why |
| --- | --- | --- |
| Web app | Next.js (App Router, TypeScript, React) | Fast full-stack iteration, route handlers, easy Vercel deployment |
| UI | Tailwind CSS, shadcn/ui, Lucide | Polished interface without custom design-system work |
| Primary app database | Supabase Postgres | Sessions, transcripts, agent runs, cached sponsor responses, demo state |
| Realtime state | Supabase Realtime | Live transcript, tool activity, and timeline updates across screens |
| File storage | Supabase Storage | Synthetic note PDFs, patient images, backup audio |
| Clinical record | Medplum FHIR | Source of truth for patient, encounters, medications, observations, documents, tasks |
| Voice | Deepgram Voice Agent API / streaming STT + Aura TTS | Low-latency voice, turn detection, transcript, spoken responses |
| Context retrieval | Moss adapter | Ambient retrieval of relevant chart context and supporting documents |
| Eligibility | Stedi test-mode eligibility API | Coverage, benefits, copay, deductible, network context |
| LLM | Provider via Deepgram or direct model API | Tool selection and structured clinical draft generation |
| Deployment | Vercel | Fast preview deploys and stable demo URL |

## Architecture boundary

**Medplum is the clinical source of truth. Supabase is the application and orchestration database.** Do not duplicate the full FHIR record in Supabase — store only IDs, session state, transcripts, generated artifacts, and cached responses.

## System data flow

```
Browser microphone
  -> Deepgram WebSocket / Voice Agent
  -> transcript events
  -> Next.js orchestration route
  -> agent state machine
       -> Medplum adapter: patient history and FHIR writes
       -> Moss adapter: relevant context retrieval
       -> Stedi adapter: test eligibility check
       -> LLM: structured draft and next-question decision
  -> Supabase: persist session, events, draft, and cache
  -> Supabase Realtime: update clinician UI
  -> clinician approval
  -> Medplum: Task, QuestionnaireResponse, DocumentReference, ClinicalImpression draft
```

## Hackathon-safe architecture decisions

- Use adapters for every sponsor integration (`src/lib/integrations/*`) so a cached fallback can replace a live API without changing the UI — every adapter returns the shared `ToolResult<T>` shape (`ok`, `source: 'live' | 'cache' | 'fixture'`, `data`, `error`, `latencyMs`).
- Persist every tool event so the demo can replay if the live voice path fails (`/api/demo/replay`).
- Keep the agent workflow deterministic after the first two questions (`src/lib/agent/orchestrator.ts`) — the LLM chooses wording, never the next state.
- Use one synthetic patient and one appointment only (Maya Thompson — see `docs/demo-script.md`).
- Deploy continuously. `main` must always contain a runnable demo.
- Use feature flags (`USE_LIVE_*`, `ALLOW_FIXTURE_FALLBACK`) for live versus mocked sponsor calls.

## Agent state machine

```
CONSENT -> LOAD_HISTORY -> OPENING_QUESTION -> IDENTIFY_GAP -> ASK_ADAPTIVE_QUESTION
  -> SAFETY_SCREEN -> RETRIEVE_SUPPORTING_CONTEXT -> BUILD_TIMELINE -> CHECK_ELIGIBILITY
  -> GENERATE_DRAFT -> PATIENT_CONFIRMATION -> CLINICIAN_REVIEW_READY
```

Safety implementation: a hard-coded red-flag checklist (breathing difficulty, facial or mouth swelling, fever, mucosal sores, blistering, rapid spread, severe pain) runs deterministically — the LLM never decides whether a flag can be ignored. Any active flag halts intake and shows the escalation message (`src/lib/agent/safety.ts`).

## Related tooling

[yc-software/qm](https://github.com/yc-software/qm) — a multiplayer agent harness (Slack + web, per-scope sandboxes, shared skills, harness-agnostic core). Not part of this stack, but worth a look if the agent orchestration work (Chiradeep) wants reference patterns for tool-scoped state, provenance/audit trails, or running the same agent core across multiple surfaces.
