# BeforeMD

Voice-first pre-visit intelligence that prepares the patient, the chart, and the clinician before the appointment.

Built for the YC × Medplum Agentic Healthcare Hackathon (August 1, 2026).

> Synthetic demo data only. BeforeMD does not diagnose, prescribe, or represent that a clinician has approved any output — see [`docs/architecture.md`](docs/architecture.md) for safety boundaries.

## Team

| Owner | Scope | Branch |
| --- | --- | --- |
| Vatsal | Product, pitch, sponsor relations, demo fixtures | `feat/demo-pitch` |
| Kashish | FHIR and Medplum | `feat/medplum-fhir` |
| Chiradeep | Agent orchestration and integrations | `feat/agent-integrations` |
| Thang | Frontend, voice UX, visualization | `feat/voice-ui` |

`main` is always deployable — merge only tested vertical slices.

## Stack

Next.js (App Router, TypeScript) · Tailwind + shadcn/ui · Supabase (Postgres, Realtime, Storage) · Medplum (FHIR source of truth) · Deepgram (voice) · Moss (context retrieval) · Stedi (eligibility) · Vercel (deploy)

Architecture boundary: **Medplum is the clinical source of truth. Supabase only stores IDs, session state, transcripts, generated artifacts, and cached sponsor responses** — never the full FHIR record. Details in [`docs/architecture.md`](docs/architecture.md).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase/Medplum/Deepgram/Moss/Stedi keys
npm run dev
```

Every sponsor integration is behind a feature flag (`USE_LIVE_*` in `.env.local`) with a fixture fallback, so the app runs end-to-end even before all credentials are wired up (`ALLOW_FIXTURE_FALLBACK=true`).

Supabase schema lives in `supabase/migrations/001_initial.sql`. Apply it with:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## Repository structure

```
docs/                   architecture, demo script, sponsor notes, fixture IDs
supabase/migrations/     schema for demo_sessions, transcript_events, agent_events, clinical_drafts, integration_cache
public/demo/             backup avatar + audio for replay-mode fallback (see public/demo/README.md)
src/app/                 clinician dashboard, intake/[sessionId], clinician/[sessionId], patient/[sessionId], api routes
src/components/          voice-orb, live-transcript, agent-activity, clinical-timeline, clinician-brief, source-evidence, coverage-card
src/lib/agent/           orchestrator (state machine), prompts, Zod schemas, safety checklist
src/lib/integrations/    medplum.ts, deepgram.ts, moss.ts, stedi.ts adapters — all return the shared ToolResult<T> shape
src/lib/supabase/        browser/server/admin Supabase clients
src/types/                shared domain types
```

## Commands

```bash
npm run dev      # local dev server
npm run build    # production build
npm run lint     # eslint
```

## Docs

- [`docs/architecture.md`](docs/architecture.md) — stack, data flow, hackathon-safe architecture decisions
- [`docs/demo-script.md`](docs/demo-script.md) — synthetic patient story and screen-by-screen demo flow
- [`docs/demo-fixtures.md`](docs/demo-fixtures.md) — Medplum FHIR resource IDs for the synthetic patient (fill in once seeded)
- [`docs/sponsor-notes.md`](docs/sponsor-notes.md) — sponsor account setup, adapter fallback ladder, judge-specific talking points
