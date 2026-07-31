-- BeforeMD initial schema (doc section 5).
-- Architecture boundary: Medplum is the clinical source of truth. This
-- database stores only IDs, session state, transcripts, generated artifacts,
-- and cached sponsor responses — never the full FHIR record.

create table public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_fhir_id text not null,
  encounter_fhir_id text,
  status text not null default 'created',
  mode text not null default 'live', -- live | replay
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.transcript_events (
  id bigint generated always as identity primary key,
  session_id uuid references public.demo_sessions(id) on delete cascade,
  speaker text not null, -- patient | agent
  text text not null,
  is_final boolean not null default true,
  sequence_no integer not null,
  created_at timestamptz not null default now()
);

create table public.agent_events (
  id bigint generated always as identity primary key,
  session_id uuid references public.demo_sessions(id) on delete cascade,
  event_type text not null, -- tool_started | tool_completed | insight | safety_flag
  tool_name text,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  sequence_no integer not null,
  created_at timestamptz not null default now()
);

create table public.clinical_drafts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid unique references public.demo_sessions(id) on delete cascade,
  chief_concern text,
  hpi jsonb,
  relevant_history jsonb,
  timeline jsonb,
  red_flags jsonb,
  unresolved_questions jsonb,
  assessment_support jsonb,
  patient_summary text,
  coverage_summary jsonb,
  clinician_status text default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.integration_cache (
  id bigint generated always as identity primary key,
  session_id uuid references public.demo_sessions(id) on delete cascade,
  provider text not null,
  request_key text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique(session_id, provider, request_key)
);

-- Realtime powers the live transcript, tool activity, and timeline updates
-- across the clinician/patient screens (doc section 3).
alter publication supabase_realtime add table public.demo_sessions;
alter publication supabase_realtime add table public.transcript_events;
alter publication supabase_realtime add table public.agent_events;
alter publication supabase_realtime add table public.clinical_drafts;

-- RLS: this is a demo app with no authenticated patient/clinician accounts.
-- All reads/writes go through server routes using the service role key, so
-- keep RLS enabled with no public policies rather than disabling it.
alter table public.demo_sessions enable row level security;
alter table public.transcript_events enable row level security;
alter table public.agent_events enable row level security;
alter table public.clinical_drafts enable row level security;
alter table public.integration_cache enable row level security;
