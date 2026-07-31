-- Local dev seed. Real FHIR IDs live in Medplum (see docs/demo-fixtures.md,
-- created once Kashish seeds the synthetic patient) — this only seeds a demo
-- session in Supabase so the app has something to load before that exists.

insert into public.demo_sessions (patient_fhir_id, status, mode, started_at)
values ('DEMO_PATIENT_FHIR_ID', 'CONSENT', 'replay', now())
on conflict do nothing;
