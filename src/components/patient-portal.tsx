"use client";

import { useRef, useState, type ReactNode } from "react";
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
import type {
  PatientContext,
  PatientConversation,
  PatientOverview,
  PatientRequest,
  PatientRequestType,
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

// --- My conversations --------------------------------------------------------

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
              className="w-full cursor-pointer rounded-t-xl px-6 py-6 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => setExpanded(isOpen ? null : conversation.sessionId)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-heading block text-base font-medium text-foreground">
                    {conversation.chiefConcern ?? "Pre-visit conversation"}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {formatDate(conversation.startedAt)} · {conversation.transcript.length}{" "}
                    messages
                    {conversation.sessionId === currentSessionId && " · this visit"}
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
    { value: "conversations", label: "My conversations" },
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
