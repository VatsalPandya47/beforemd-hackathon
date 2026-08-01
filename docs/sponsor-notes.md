# Sponsor notes

## Accounts to create or verify

| Service | Required setup |
| --- | --- |
| GitHub | Private repository, all teammates added |
| Vercel | Project connected to `main`, environment variables configured |
| Supabase | Project, SQL migration applied, Realtime enabled on event tables, Storage bucket |
| Medplum | Project/client credentials, synthetic resources, tested read and create |
| Deepgram | API key and working streaming or Voice Agent example |
| Moss | Sponsor access, docs, API key, endpoint, and example response |
| Stedi | Test API key and successful mock eligibility request |
| Model provider | API key or managed Deepgram configuration |

Each sponsor integration has a `USE_LIVE_<NAME>` flag and `ALLOW_FIXTURE_FALLBACK` — every key should be tested live, or the fixture fallback confirmed working, before the demo.

## Account status (as of 2026-07-31)

All five accounts are created and credentials are verified live (values are in `.env.local` / Vercel project env, not committed):

- **Medplum** — project "BeforeMD" created, default client application credentials confirmed via `startClientLogin` + a live `Patient` search (0 results — no synthetic data seeded yet, see issue #7).
- **Deepgram** — account created, key confirmed via `manage.v1.projects.list()`.
- **Stedi** — clearinghouse account created (sandbox/test mode only on the free tier), key confirmed with a full mock 271 eligibility response. Working test payload:
  ```json
  {
    "controlNumber": "123456789",
    "tradingPartnerServiceId": "60054",
    "provider": { "organizationName": "BeforeMD", "npi": "1999999984" },
    "subscriber": { "firstName": "Jane", "lastName": "Doe", "memberId": "AETNA12345" },
    "encounter": { "serviceTypeCodes": ["30"] }
  }
  ```
  POST to `https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3` with header `Authorization: <STEDI_API_KEY>` (no `Bearer` prefix). Returns a real mock 271 with active coverage, benefits, and copay/deductible data for Aetna (payer ID `60054`).
- **Moss** — project "beforemd-hackathon" created (`MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` in env). Real API confirmed via `POST https://service.usemoss.dev/v1/manage` with headers `x-project-key: <MOSS_PROJECT_KEY>`, `x-service-version: v1`, and `{"projectId": "...", "action": "validateCredentials"}` in the body → `{"valid":true,...}`. Supported actions per the API's own error response: `validateCredentials, initUpload, startBuild, getJobStatus, addDocs, deleteDocs, pushLocalIndex, telemetry, reportUsage, getIndex, listIndexes, deleteIndex, getDocs, getIndexUrl` — no dedicated retrieval/search action was in that list, so the actual query-time retrieval call still needs to be found (check the TypeScript SDK `@inferedge/moss` or `docs.moss.dev` for the query API) before wiring `src/lib/integrations/moss.ts` (issue #12).
- **LLM** — no signup needed. Vercel AI Gateway via the `VERCEL_OIDC_TOKEN` already pulled from the Supabase provisioning step. `openai/gpt-5-nano` and `google/gemini-2.5-flash-lite` both work on the free tier; several larger models (e.g. `anthropic/claude-haiku-4.5`) 403 until paid credits are added.

## Moss uncertainty plan

`src/lib/integrations/moss.ts` is built fixture-first — only its internals should change once the retrieval endpoint shape is confirmed (the management API above is confirmed; the query/search endpoint is not — see Account status above). The rest of the product must not depend on Moss-specific response shapes; callers only ever see `RetrievedContext[]`.

## Judge-specific reasons to care

| Audience | What they should see |
| --- | --- |
| YC | A focused wedge that could become a large workflow company |
| Medplum | Correct, visible FHIR reads and writes in a real clinical workflow |
| Deepgram | A natural, low-latency voice experience with adaptive conversation |
| Moss | Relevant context appearing before the user explicitly searches for it |
| Stedi | Eligibility data affecting the patient experience, not an isolated API call |
| Clinical reviewers | Human oversight, sources, uncertainty, and red-flag handling |

## Likely questions and answers

- **Is this a diagnostic tool?** No. It prepares a sourced draft and structured intake for clinician review.
- **Why not use an intake form?** The conversation adapts to history and answers, then connects events across time.
- **Who pays?** Specialty clinics and healthcare organizations that want shorter intake time, better documentation, and fewer missing details.
- **What is the initial wedge?** High-volume specialty clinics with repetitive pre-visit intake, starting with dermatology.
- **What is technically difficult?** Real-time voice, longitudinal FHIR context, reliable tool orchestration, provenance, and safe human review.
- **Why can this become large?** The same intelligence layer can prepare every encounter across specialties, modalities, and administrative workflows.

## Submission package

- Production URL.
- GitHub repository URL.
- One-sentence product description.
- Problem, solution, and sponsor usage paragraph.
- 90-second backup demo video.
- Three screenshots: voice intake, timeline reveal, clinician brief.
- Synthetic-data and clinician-review disclaimer.
- Names and contact information for all team members.

## Final go/no-go checklist

| Check | Go condition |
| --- | --- |
| Demo | Runs successfully three times in a row |
| Voice | Live path and backup audio both work |
| Clinical data | Every displayed claim has a source or is labeled patient-reported |
| Safety | Red-flag branch is deterministic and tested |
| Sponsor integrations | Each sponsor has a visible, meaningful action |
| Performance | No screen waits silently for more than two seconds without progress UI |
| Pitch | Under three minutes with 15 seconds of buffer |
| Submission | Submitted at least 20 minutes before deadline |
| Backup | Stable deployment, replay mode, and video are accessible |
