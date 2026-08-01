-- The clinician draft carries a keyConnection (doc section 7 schema) — the
-- medication/rash timing statement that is the demo's key reveal. 001 had no
-- column for it, so the agent generated it and the route dropped it on write.
-- Additive and safe to re-run against an existing demo database.
alter table public.clinical_drafts
  add column if not exists key_connection jsonb;
