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
| Patient | Maya's demographics and identifiers | `718cf8c0-a789-460e-830a-06922744e42b` |
| Appointment | Upcoming dermatology visit | `0214fa7a-bfea-4af8-a393-a9d5adecaafd` |
| Encounter | Pre-visit intake encounter | `09ec4658-2803-44b2-b99b-a075750ae6ec` |
| MedicationRequest | Lamotrigine start date and status | `54e002a3-3729-4efd-a871-4c14b55bb922` |
| MedicationStatement | Patient-reported medication usage or restart | `8efe38a0-eed9-4925-b74f-a7f76dafbd06` |
| Condition | Rash or dermatitis history | `11fb9a58-bfa5-4f4f-aea1-cf6f2d9cded4` |
| AllergyIntolerance | Known allergies and safety context | `43e2f83a-11ac-45e2-9884-1d01d1f70c6b` |
| Observation | Symptom severity or patient-reported findings | `9aaa7f33-428d-4ae9-911b-1078f7cf0136` |
| DocumentReference | Prior note mentioning the first rash episode | `2c06ba1a-4856-45b6-8ff2-7caf7f855f71` |
| QuestionnaireResponse | Structured answers from the voice intake | written at runtime by `writeDraft` |
| ClinicalImpression | Draft reasoning support, explicitly unverified | written at runtime by `writeDraft` |
| Task | Clinician review task | written at runtime by `writeDraft` |
| Communication | Patient-facing follow-up summary | not implemented |
| Provenance | Optional record of agent-generated artifacts | not implemented |

## Seed requirements

- Create all FHIR resources before the event.
- Dates are hardcoded in the seed script to match `src/lib/demo-fixtures.ts` exactly, so live
  Medplum and the fixture fallback render an identical timeline — if the live path fails mid-demo,
  the fallback is invisible. `--dry-run` asserts they stay in sync. Change a date in one place and
  the check fails until you change it in the other.
- Include one prior note that mentions the first rash episode and topical treatment.
- Include one medication start date that enables the 11-day correlation.
- Include no real names, medical record numbers, or identifiable data.
