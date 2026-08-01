-- Realtime read policies for the demo screens (#16, and #30 needs the third).
--
-- 001 enabled RLS on these tables with no policies, on the stated grounds that
-- every read goes through a server route on the service role key. That stops
-- being true once the intake transcript and activity rail subscribe from the
-- browser: Realtime's postgres_changes enforces RLS against the *subscribing*
-- role, which is the anon role the publishable key carries. With no policy a
-- subscription connects, reports SUBSCRIBED, and then stays silent forever --
-- the exact failure this migration exists to prevent, and one that looks like
-- "the demo is just quiet" rather than like an error.
--
-- Read-only, and demo-scoped. Writes still go exclusively through server routes
-- on the service role key. There are no patient or clinician accounts to scope
-- these policies by, so the grant is unqualified: anyone holding the publishable
-- key (which ships in the client bundle) can read any session's transcript.
-- That is acceptable because every row here is synthetic data for the seeded
-- Maya Thompson session, and it would not be acceptable for real patients.
--
-- Additive and safe to re-run against an existing demo database.

drop policy if exists "demo anon read transcript events" on public.transcript_events;
create policy "demo anon read transcript events"
  on public.transcript_events for select to anon using (true);

drop policy if exists "demo anon read agent events" on public.agent_events;
create policy "demo anon read agent events"
  on public.agent_events for select to anon using (true);

-- The clinician screen loads and then follows this session's draft (#30).
drop policy if exists "demo anon read clinical drafts" on public.clinical_drafts;
create policy "demo anon read clinical drafts"
  on public.clinical_drafts for select to anon using (true);
