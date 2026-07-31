# Demo fixtures — Medplum FHIR resource IDs

Kashish: fill in real resource IDs here once the synthetic patient is seeded in Medplum, then update `.env.local` (`DEMO_PATIENT_FHIR_ID`, `DEMO_ENCOUNTER_FHIR_ID`, `DEMO_APPOINTMENT_FHIR_ID`) and `src/lib/demo-fixtures.ts` to match.

| FHIR resource | Use in demo | Resource ID |
| --- | --- | --- |
| Patient | Maya's demographics and identifiers | _pending_ |
| Appointment | Upcoming dermatology visit | _pending_ |
| Encounter | Pre-visit intake encounter | _pending_ |
| MedicationRequest | Lamotrigine start date and status | _pending_ |
| MedicationStatement | Patient-reported medication usage or restart | _pending_ |
| Condition | Rash or dermatitis history | _pending_ |
| AllergyIntolerance | Known allergies and safety context | _pending_ |
| Observation | Symptom severity or patient-reported findings | _pending_ |
| DocumentReference | Prior note, discharge document, or uploaded image | _pending_ |
| QuestionnaireResponse | Structured answers from the voice intake | _pending_ |
| ClinicalImpression | Draft reasoning support, explicitly unverified | _pending_ |
| Task | Clinician review task | _pending_ |
| Communication | Patient-facing follow-up summary | _pending_ |
| Provenance | Optional record of agent-generated artifacts | _pending_ |

## Seed requirements

- Create all FHIR resources before the event.
- Use dates relative to the event so the timeline feels current (see `src/lib/demo-fixtures.ts` for placeholder dates to update).
- Include one prior note that mentions the first rash episode and topical treatment.
- Include one medication start date that enables the 11-day correlation.
- Include no real names, medical record numbers, or identifiable data.
