# Demo fixtures — Medplum FHIR resource IDs

Seeded by `scripts/seed-medplum.mjs` (issue #7).

```bash
node scripts/seed-medplum.mjs --dry-run   # validates dates + resource shape, no network, no credentials
npm run seed:medplum                      # live; needs MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET in .env.local
```

The script is re-runnable: every resource carries `identifier = urn:beforemd:demo|maya-thompson`,
and each run deletes everything bearing that identifier before recreating it. That identifier is
the only thing it will ever delete.

After a live run, paste the three printed IDs into `.env.local` and the Vercel project env, and
fill the table below.

Seeded 2026-08-01. **Every reseed issues new IDs** — re-run means re-pasting `.env.local`
and this table.

| FHIR resource | Use in demo | Resource ID |
| --- | --- | --- |
| Patient | Maya's demographics and identifiers | `54dbb9a7-7430-414b-9b82-9914a552212c` |
| Practitioner | Dr. Elena Ruiz, dermatology — the care team and the July visit | `504bc5dc-798d-42ad-bfec-e21de1492022` |
| Practitioner | Dr. Marcus Hale, family medicine — on the intake encounter | `45ebe31f-aaaf-4b20-948c-b502415f7901` |
| Appointment | Upcoming dermatology visit | `a77c6593-5fe3-4872-9683-6f0e630cbaeb` |
| Encounter | Pre-visit intake encounter (`planned`) | `21e8a500-a43d-4501-a5dc-7317c170e829` |
| Encounter | July dermatology visit (`finished`) — the past visit in the portal | `1d089cd4-e9ee-483b-96aa-a9644799cf63` |
| MedicationRequest | Lamotrigine start date and status | `490867b9-1dd2-4786-abae-a66f13fa22ac` |
| MedicationStatement | Patient-reported medication usage or restart | `396b151e-9b84-419e-9850-7bf0e59cee68` |
| Condition | Rash or dermatitis history | `21d702f0-7908-46d3-8c3d-5d4beb155768` |
| AllergyIntolerance | Known allergies and safety context | `cc01ce33-2b73-4940-906b-1e6f1c55f092` |
| Observation | Symptom severity or patient-reported findings | `6f754b7b-1758-4773-9226-33a1fb45452c` |
| DocumentReference | Prior note mentioning the first rash episode | `fa40017d-13d9-4f57-a871-7727ac362e29` |
| QuestionnaireResponse | Structured answers from the voice intake | written at runtime by `writeDraft` |
| ClinicalImpression | Draft reasoning support, explicitly unverified | written at runtime by `writeDraft` |
| Task | Clinician review task | written at runtime by `writeDraft` |
| Task | Patient request (question / refill / appointment / records) | written at runtime by `createPatientRequest` |
| Communication | Patient-facing follow-up summary | not implemented |
| Provenance | Optional record of agent-generated artifacts | not implemented |

Note there are **two** Encounters. `DEMO_ENCOUNTER_FHIR_ID` is the `planned` intake one — the
script picks it by status, not by position. The `finished` one is what the patient portal shows
under past visits, and it is what makes "doctors you have seen" non-empty.

Patient-request Tasks deliberately carry **no** demo identifier, so a reseed leaves them in place
rather than deleting them. They accumulate across demo runs, the same way the clinician-review
Tasks from `writeDraft` do. Nothing reads them except the patient portal, which finds them by
`requester`.

Two consequences worth knowing rather than discovering:

- **A reseed leaves them pointing at a deleted Patient.** `requester` and `for` become dangling
  references on the chart. Nothing in this app follows them — the portal searches by the *new*
  patient id, so old Tasks simply stop appearing — but they are real broken references in the
  Medplum project, not tidy orphans. Delete them by hand if a judge is going to browse the project.
- **They are read one page at a time.** `listPatientRequests` passes `_sort=-authored-on` and
  `_count=50`; past 50 accumulated requests the oldest stop appearing.

## Seed requirements

- Create all FHIR resources before the event.
- Dates are hardcoded in the seed script to match `src/lib/demo-fixtures.ts` exactly, so live
  Medplum and the fixture fallback render an identical timeline — if the live path fails mid-demo,
  the fallback is invisible. `--dry-run` asserts they stay in sync. Change a date in one place and
  the check fails until you change it in the other.
- Include one prior note that mentions the first rash episode and topical treatment.
- Include one medication start date that enables the 11-day correlation.
- Include no real names, medical record numbers, or identifiable data.
