"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CoverageCard } from "@/components/coverage-card";
import { LiveTranscript } from "@/components/live-transcript";
import { SourceEvidence } from "@/components/source-evidence";
import { formatCents, formatDollars, formatPercent } from "@/lib/format-money";
import type {
  CostEstimate,
  CostEstimateResponse,
  CostExplanation,
  PatientContext,
  PatientConversation,
  PatientOverview,
  PatientRequest,
  PatientRequestType,
  SavedCostEstimate,
  VisitHistory,
  VisitSummary,
} from "@/types";

// The patient's own view of their record. Everything here is already in the
// system — the agent reads the chart on every intake turn — it just had nowhere
// to be seen. Kept in one file rather than four: the panels are display code
// with no logic to share, and splitting them would be scaffolding.

function formatDate(value: string | null): string {
  if (!value) return "Date not recorded";
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "d MMM yyyy");
}

function Section({
  title,
  empty,
  children,
  count,
}: {
  title: string;
  empty: string;
  children: ReactNode;
  count: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  primary,
  secondary,
  aside,
}: {
  primary: string;
  secondary?: string | null;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{primary}</p>
        {secondary && <p className="text-xs text-slate-500">{secondary}</p>}
      </div>
      {aside}
    </div>
  );
}

// --- My health ---------------------------------------------------------------

function HealthPanel({ patient }: { patient: PatientContext }) {
  // Three sections that differ only in their title, their FHIR type, and which
  // two fields they read. Documents are not in here — they carry an excerpt.
  const sections = [
    {
      title: "Medications",
      empty: "No medications on file.",
      sourceType: "MedicationRequest",
      rows: patient.medications.map((m) => ({
        fhirId: m.fhirId,
        primary: m.name,
        secondary: `${m.status} · started ${formatDate(m.startDate)}`,
      })),
    },
    {
      title: "Conditions",
      empty: "No conditions on file.",
      sourceType: "Condition",
      rows: patient.conditions.map((c) => ({
        fhirId: c.fhirId,
        primary: c.name,
        secondary: `First noted ${formatDate(c.onsetDate)}`,
      })),
    },
    {
      title: "Allergies",
      empty: "No allergies on file.",
      sourceType: "AllergyIntolerance",
      rows: patient.allergies.map((a) => ({
        fhirId: a.fhirId,
        primary: a.substance,
        secondary: a.reaction,
      })),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <Section
          key={section.title}
          title={section.title}
          empty={section.empty}
          count={section.rows.length}
        >
          {section.rows.map((row) => (
            <Row
              key={row.fhirId}
              primary={row.primary}
              secondary={row.secondary}
              aside={
                <SourceEvidence
                  sourceType={section.sourceType}
                  sourceId={row.fhirId}
                  label="Source"
                />
              }
            />
          ))}
        </Section>
      ))}

      <Section
        title="Notes and documents"
        empty="No documents on file."
        count={patient.priorDocuments.length}
      >
        {patient.priorDocuments.map((document) => (
          <div
            key={document.fhirId}
            className="flex flex-col gap-1 border-b border-slate-100 pb-3 last:border-0 last:pb-0"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{document.title}</p>
                <p className="text-xs text-slate-500">{formatDate(document.date)}</p>
              </div>
              <SourceEvidence
                sourceType="DocumentReference"
                sourceId={document.fhirId}
                label="Source"
              />
            </div>
            {document.excerpt && (
              <p className="mt-1 rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                {document.excerpt}
              </p>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}

/**
 * The health record as a slide-out, for the intake screen — so the patient can
 * see what the clinic already has on them *before* being asked to talk about
 * it. A sheet rather than a link to /patient/[sessionId]: navigating away
 * mid-intake would tear down the voice session and the transcript.
 */
export function HealthRecordSheet({ sessionId }: { sessionId: string }) {
  const [patient, setPatient] = useState<PatientContext | null>(null);
  const [isFixture, setIsFixture] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards the request, not the result: open/close/open before the first fetch
  // settles would otherwise fire a second one.
  const loading = useRef(false);

  // Loaded when the sheet is first opened rather than on mount: this screen's
  // job is the conversation, and it should not spend a Medplum round trip on a
  // panel most sessions never open. Fetched once, then cached in state.
  async function load() {
    if (patient || loading.current) return;
    loading.current = true;
    setError(null);
    try {
      // section=health, not the full overview: this panel renders `patient` and
      // nothing else, and it opens mid-voice-session. The full payload would
      // also fetch visits, requests and the transcript, all discarded here.
      const response = await fetch(
        `/api/patient/overview?section=health&sessionId=${encodeURIComponent(sessionId)}`
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (typeof body?.error === "string" && body.error) ||
            `Could not load your record (${response.status})`
        );
      }
      setPatient(body.patient);
      setIsFixture(body.source !== "live");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load your record");
    } finally {
      loading.current = false;
    }
  }

  return (
    <Sheet
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <SheetTrigger render={<Button variant="outline" />}>
        View my health record
      </SheetTrigger>
      <SheetContent side="left" className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Your health record</SheetTitle>
          <SheetDescription>
            What your clinician already has on file, before you start.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-4 pt-0">
          {isFixture && (
            <Badge className="w-fit bg-amber-100 text-amber-900" variant="secondary">
              Showing demo data — not a live record
            </Badge>
          )}
          {!patient && !error && (
            <p className="text-sm text-muted-foreground">Loading your record…</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {patient && <HealthPanel patient={patient} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --- My visits ---------------------------------------------------------------

function VisitRow({ visit }: { visit: VisitSummary }) {
  return (
    <Row
      primary={visit.description}
      secondary={[
        formatDate(visit.date),
        visit.practitionerName ?? "Clinician not recorded",
        visit.status,
      ].join(" · ")}
      aside={
        <SourceEvidence
          sourceType={visit.resourceType}
          sourceId={visit.fhirId}
          label="Source"
        />
      }
    />
  );
}

function VisitsPanel({
  visits,
  coverage,
}: {
  visits: VisitHistory;
  coverage: PatientOverview["coverage"];
}) {
  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Upcoming"
        empty="No upcoming appointments."
        count={visits.upcoming.length}
      >
        {visits.upcoming.map((visit) => (
          <VisitRow key={visit.fhirId} visit={visit} />
        ))}
      </Section>

      <Section
        title="Your care team"
        empty="No clinicians recorded on your visits yet."
        count={visits.careTeam.length}
      >
        {visits.careTeam.map((member) => (
          <Row
            key={member.fhirId}
            primary={member.name}
            secondary={member.specialty}
            aside={
              <SourceEvidence
                sourceType="Practitioner"
                sourceId={member.fhirId}
                label="Source"
              />
            }
          />
        ))}
      </Section>

      <Section title="Past visits" empty="No past visits on file." count={visits.past.length}>
        {visits.past.map((visit) => (
          <VisitRow key={visit.fhirId} visit={visit} />
        ))}
      </Section>

      {coverage && <CoverageCard coverage={coverage} />}
    </div>
  );
}

// --- This conversation -------------------------------------------------------

function ConversationsPanel({
  conversations,
  currentSessionId,
}: {
  conversations: PatientConversation[];
  currentSessionId: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(currentSessionId);

  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            You have not had a pre-visit conversation yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {conversations.map((conversation) => {
        const isOpen = expanded === conversation.sessionId;
        return (
          <Card key={conversation.sessionId}>
            {/* A real button, not a clickable CardHeader: the div version was
                not focusable, not operable from the keyboard, and announced
                nothing about being expandable. */}
            <button
              type="button"
              aria-expanded={isOpen}
              className="w-full cursor-pointer rounded-t-xl px-(--card-spacing) text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => setExpanded(isOpen ? null : conversation.sessionId)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-heading block text-base leading-snug font-medium text-foreground">
                    {conversation.chiefConcern ?? "Pre-visit conversation"}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {formatDate(conversation.startedAt)} · {conversation.transcript.length}{" "}
                    messages
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {conversation.mode === "replay" && (
                    <Badge variant="secondary">Replay</Badge>
                  )}
                  <Badge variant="outline">{conversation.status}</Badge>
                </div>
              </div>
            </button>

            {isOpen && (
              <CardContent>
                {conversation.transcript.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing was recorded in this conversation.
                  </p>
                ) : (
                  // `interim` is optional, so this renders a finished transcript
                  // with the same bubbles the live intake screen uses.
                  <LiveTranscript events={conversation.transcript} />
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// --- Requests ----------------------------------------------------------------

const REQUEST_TYPES: {
  value: PatientRequestType;
  label: string;
  needs?: "medication" | "appointment";
  placeholder: string;
}[] = [
  {
    value: "question",
    label: "Ask my care team a question",
    placeholder: "What would you like to ask before your visit?",
  },
  {
    value: "refill",
    label: "Request a medication refill",
    needs: "medication",
    placeholder: "Anything your care team should know about this refill?",
  },
  {
    value: "appointment",
    label: "Request or reschedule an appointment",
    needs: "appointment",
    placeholder: "When would suit you better?",
  },
  {
    value: "records",
    label: "Request a copy of my records",
    placeholder: "Which records would you like a copy of?",
  },
];

const selectClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

function RequestsPanel({
  sessionId,
  requests,
  patient,
  visits,
  canFile,
  onFiled,
}: {
  sessionId: string;
  requests: PatientRequest[];
  patient: PatientContext;
  visits: VisitHistory;
  canFile: boolean;
  onFiled: () => void;
}) {
  const [type, setType] = useState<PatientRequestType>("question");
  const [message, setMessage] = useState("");
  const [focusReference, setFocusReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);

  const selected = REQUEST_TYPES.find((option) => option.value === type)!;

  function changeType(next: PatientRequestType) {
    setType(next);
    // The old selection belongs to the old request type — a MedicationRequest
    // reference on an appointment request would be a dangling focus.
    setFocusReference("");
    setError(null);
    setFiled(null);
  }

  async function submit() {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setFiled(null);

    try {
      const response = await fetch("/api/patient/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          type,
          message: message.trim(),
          ...(focusReference ? { focusReference } : {}),
        }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          (typeof body?.error === "string" && body.error) ||
            `Your request could not be filed (HTTP ${response.status}).`
        );
        return;
      }

      setMessage("");
      setFocusReference("");
      setFiled(body?.request?.fhirId ?? null);
      onFiled();
    } catch {
      setError("Could not reach the server. Your request was not filed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Make a request</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!canFile && (
            // Nothing would reach the chart, so the form does not pretend
            // otherwise — the same rule the clinician screen follows before
            // letting anyone approve a fixture.
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Requests are unavailable right now because the record system is running on
              demo data. Nothing you send would reach your care team.
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">What do you need?</span>
            <select
              className={selectClass}
              value={type}
              disabled={!canFile}
              onChange={(event) => changeType(event.target.value as PatientRequestType)}
            >
              {REQUEST_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {selected.needs === "medication" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Which medication?</span>
              <select
                className={selectClass}
                value={focusReference}
                disabled={!canFile}
                onChange={(event) => setFocusReference(event.target.value)}
              >
                <option value="">Not listed / something else</option>
                {patient.medications.map((medication) => (
                  <option
                    key={medication.fhirId}
                    value={`MedicationRequest/${medication.fhirId}`}
                  >
                    {medication.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {selected.needs === "appointment" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">
                Which appointment?
              </span>
              <select
                className={selectClass}
                value={focusReference}
                disabled={!canFile}
                onChange={(event) => setFocusReference(event.target.value)}
              >
                <option value="">A new appointment</option>
                {visits.upcoming.map((visit) => (
                  <option key={visit.fhirId} value={`Appointment/${visit.fhirId}`}>
                    {visit.description} — {formatDate(visit.date)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Your message</span>
            <Textarea
              value={message}
              disabled={!canFile}
              placeholder={selected.placeholder}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>

          <Button
            className="self-start"
            onClick={submit}
            disabled={!canFile || submitting || !message.trim()}
          >
            {submitting ? "Sending…" : "Send request"}
          </Button>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {filed && (
            <p className="text-sm text-emerald-700">
              Sent to your care team. Saved as{" "}
              <span className="font-mono text-xs break-all">Task/{filed}</span>.
            </p>
          )}
        </CardContent>
      </Card>

      <Section
        title="Your requests"
        empty="You have not made any requests yet."
        count={requests.length}
      >
        {requests.map((request) => (
          <Row
            key={request.fhirId}
            primary={request.message}
            secondary={`${REQUEST_TYPES.find((o) => o.value === request.type)?.label ?? "Request"} · ${formatDate(request.authoredOn)} · ${request.status}`}
            aside={
              <SourceEvidence sourceType="Task" sourceId={request.fhirId} label="Source" />
            }
          />
        ))}
      </Section>
    </div>
  );
}

// --- What this visit costs ---------------------------------------------------

const CONFIDENCE_VARIANT = {
  high: "success",
  medium: "secondary",
  low: "outline",
} as const;

/** One line of the balance sheet. Emphasised rows carry the totals. */
function MoneyRow({
  label,
  amount,
  note,
  tone = "plain",
}: {
  label: string;
  amount: string;
  note?: string;
  tone?: "plain" | "credit" | "total";
}) {
  return (
    <div
      className={
        tone === "total"
          ? "flex items-baseline justify-between gap-3 border-t border-slate-200 pt-3"
          : "flex items-baseline justify-between gap-3"
      }
    >
      <div className="min-w-0">
        <p
          className={
            tone === "total"
              ? "text-sm font-semibold text-slate-900"
              : "text-sm text-slate-700"
          }
        >
          {label}
        </p>
        {note && <p className="text-xs text-slate-500">{note}</p>}
      </div>
      <p
        className={
          tone === "total"
            ? "font-heading shrink-0 text-lg font-semibold text-slate-900"
            : tone === "credit"
              ? "shrink-0 text-sm text-emerald-700 tabular-nums"
              : "shrink-0 text-sm text-slate-900 tabular-nums"
        }
      >
        {amount}
      </p>
    </div>
  );
}

function CostPanel({ sessionId }: { sessionId: string }) {
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<CostEstimateResponse["source"] | null>(null);

  const [explanation, setExplanation] = useState<CostExplanation | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ question: string; text: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedCostEstimate | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Base UI unmounts an inactive tab panel, so this runs when the tab is first
  // opened rather than on portal load — the estimate costs an eligibility check
  // and a Medplum search, and most of the demo never opens this tab.
  //
  // The numbers and the explanation are two requests on purpose: the breakdown
  // is deterministic and instant, the paragraph waits on a model. Rendering the
  // first without blocking on the second is the whole reason the route is split.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `/api/patient/estimate?sessionId=${encodeURIComponent(sessionId)}`
        );
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setLoadError(typeof body.error === "string" ? body.error : "Estimate unavailable");
          return;
        }
        setEstimate(body.estimate);
        setSource(body.source);
      } catch {
        if (!cancelled) setLoadError("Could not reach the server");
        return;
      }

      try {
        const response = await fetch("/api/patient/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (!response.ok || cancelled) return;
        setExplanation(await response.json());
      } catch {
        // The breakdown is already on screen and speaks for itself; a missing
        // paragraph is not worth an error state.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      const response = await fetch("/api/patient/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, question: trimmed }),
      });
      const body = await response.json();
      setAnswer({
        question: trimmed,
        text: response.ok ? body.text : "That question could not be answered right now.",
      });
      setQuestion("");
    } catch {
      setAnswer({ question: trimmed, text: "That question could not be answered right now." });
    } finally {
      setAsking(false);
    }
  }

  async function proceed() {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/patient/estimate/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setSaveError(
          typeof body.error === "string" ? body.error : "Your estimate could not be saved."
        );
        return;
      }
      setSaved(body.saved);
    } catch {
      setSaveError("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            {loadError.replace(/\.?$/, ".")} Reload to try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!estimate) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Working out what this visit will cost…</p>
        </CardContent>
      </Card>
    );
  }

  const coinsuranceLabel =
    estimate.coinsuranceRate !== null
      ? `Coinsurance (${formatPercent(estimate.coinsuranceRate)})`
      : "Coinsurance";

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Estimated cost of this visit</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              {estimate.serviceDescription}
              {estimate.appointmentDate && ` · ${formatDate(estimate.appointmentDate)}`}
            </p>
          </div>
          <Badge variant={CONFIDENCE_VARIANT[estimate.confidence]} className="shrink-0 capitalize">
            {estimate.confidence} confidence · {estimate.confidencePct}%
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted-foreground">You pay about</p>
            <p className="font-heading text-4xl font-semibold text-slate-900">
              {formatDollars(estimate.patientPaysCents)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Likely between {formatDollars(estimate.lowCents)} and{" "}
              {formatDollars(estimate.highCents)}. This is an estimate, not a bill.
            </p>
          </div>

          {/* The breakdown. Every figure that produced the number above, rather
              than a total the patient has to take on trust. */}
          <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-4">
            <MoneyRow
              label="Full price for this visit"
              note={estimate.rateBasis}
              amount={formatCents(estimate.allowedAmountCents)}
            />
            {estimate.deductibleAppliedCents > 0 && (
              <MoneyRow
                label="Your deductible"
                note="What you pay yourself before the plan starts covering costs"
                amount={formatCents(estimate.deductibleAppliedCents)}
              />
            )}
            {estimate.coinsuranceCents > 0 && (
              <MoneyRow
                label={coinsuranceLabel}
                note="Your share of what is left after the deductible"
                amount={formatCents(estimate.coinsuranceCents)}
              />
            )}
            {estimate.copayCents > 0 && (
              <MoneyRow
                label="Copay"
                note="A flat fee for the visit, because your deductible is met"
                amount={formatCents(estimate.copayCents)}
              />
            )}
            <MoneyRow
              label="Your insurance pays"
              amount={`−${formatCents(estimate.insurancePaysCents)}`}
              tone="credit"
            />
            <MoneyRow
              label="Estimated you pay"
              amount={formatCents(estimate.patientPaysCents)}
              tone="total"
            />
          </div>
        </CardContent>
      </Card>

      {/* Every input, not just the answer — the patient can check the working. */}
      <Section title="What this is based on" empty="" count={1}>
        <Row primary="Plan" secondary={estimate.planName} />
        <Row primary="Network" secondary={estimate.network} />
        <Row
          primary="Full price agreed with your plan"
          secondary={`${formatCents(estimate.allowedAmountCents)} · ${estimate.rateBasis}`}
        />
        <Row
          primary="Deductible remaining before this visit"
          secondary={formatCents(estimate.deductibleRemainingCents)}
        />
        <Row
          primary="Your coinsurance rate"
          secondary={
            estimate.coinsuranceRate !== null
              ? `${formatPercent(estimate.coinsuranceRate)} of costs after the deductible`
              : "Not reported by your plan"
          }
        />
        {estimate.assumptions.map((assumption) => (
          <Row key={assumption} primary={assumption} />
        ))}
        <p className="text-xs text-slate-500">
          Benefits checked with Stedi. The full price is a contracted-rate estimate, not a quote
          from your plan.
        </p>
      </Section>

      <Section title="What this means" empty="" count={1}>
        <p className="text-sm text-slate-700">
          {explanation?.text ?? "Putting this into plain English…"}
        </p>

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap gap-2">
            {["Why is it so expensive?", "What is a deductible?", "Could I pay less?"].map(
              (preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={asking}
                  onClick={() => ask(preset)}
                >
                  {preset}
                </Button>
              )
            )}
          </div>
          <Textarea
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask anything about this estimate"
            disabled={asking}
          />
          <div>
            <Button type="button" size="sm" disabled={asking || !question.trim()} onClick={() => ask(question)}>
              {asking ? "Asking…" : "Ask"}
            </Button>
          </div>
          {answer && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">{answer.question}</p>
              <p className="mt-1 text-sm text-slate-700">{answer.text}</p>
            </div>
          )}
        </div>
      </Section>

      <Section title="This may change if" empty="" count={estimate.couldChange.length}>
        {estimate.couldChange.map((item) => (
          <Row key={item} primary={item} />
        ))}
      </Section>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          {saved ? (
            <>
              <p className="text-sm text-slate-700">
                Saved to your record. Your care team can see the{" "}
                {formatDollars(saved.patientPaysCents)} estimate you were shown.
              </p>
              <SourceEvidence sourceType="Claim" sourceId={saved.claimFhirId} label="Saved as" />
            </>
          ) : (
            <>
              <p className="text-sm text-slate-700">
                Happy to go ahead? We will save this estimate to your record so your care team
                knows what you were told.
              </p>
              {/* Deliberately not gated on `source`: the accept route surfaces the
                  real reason a save failed, which beats a disabled button. */}
              <div>
                <Button type="button" disabled={saving} onClick={proceed}>
                  {saving ? "Saving…" : "Proceed with appointment"}
                </Button>
              </div>
              {saveError && <p className="text-sm text-destructive">{saveError}</p>}
            </>
          )}
          {source !== "live" && (
            <p className="text-xs text-amber-700">
              This estimate uses demo benefit data, so it cannot be saved to a real chart.
            </p>
          )}
          <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
            Last year, 62% of Americans received an unexpected medical bill. We help patients
            understand their costs before they receive one.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Portal ------------------------------------------------------------------

export function PatientPortal({
  overview,
  sessionId,
  onRefresh,
}: {
  overview: PatientOverview;
  sessionId: string;
  onRefresh: () => void;
}) {
  const tabs = [
    { value: "health", label: "My health" },
    { value: "visits", label: "My visits" },
    // Singular: the overview route scopes conversations to this session, so the
    // tab is always exactly one.
    { value: "cost", label: "What it costs" },
    { value: "conversations", label: "This conversation" },
    { value: "requests", label: "Requests" },
  ];

  return (
    <Tabs defaultValue="health" className="gap-4">
      <TabsList className="w-full sm:w-fit">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="health">
        <HealthPanel patient={overview.patient} />
      </TabsContent>

      <TabsContent value="visits">
        <VisitsPanel visits={overview.visits} coverage={overview.coverage} />
      </TabsContent>

      <TabsContent value="cost">
        <CostPanel sessionId={sessionId} />
      </TabsContent>

      <TabsContent value="conversations">
        <ConversationsPanel
          conversations={overview.conversations}
          currentSessionId={sessionId}
        />
      </TabsContent>

      <TabsContent value="requests">
        <RequestsPanel
          sessionId={sessionId}
          requests={overview.requests}
          patient={overview.patient}
          visits={overview.visits}
          // Writes have no fixture path, so a fixture read is a reliable signal
          // that a write would fail too.
          canFile={overview.source === "live"}
          onFiled={onRefresh}
        />
      </TabsContent>
    </Tabs>
  );
}
