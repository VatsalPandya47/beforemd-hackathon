"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ClinicianBrief } from "@/components/clinician-brief";
import type { ApproveResponse, ClinicalDraft } from "@/types";

export default function ClinicianReviewPage() {
  const params = useParams<{ sessionId: string }>();
  // Starts empty rather than seeded with the fixture (#30). Seeding meant this
  // screen showed Maya Thompson's scripted brief for every session, live or
  // replayed, no matter what the patient actually said — and a clinician could
  // approve a record that had nothing to do with the conversation they had just
  // reviewed. The draft is loaded for this session id instead.
  const [draft, setDraft] = useState<ClinicalDraft | null>(null);
  const [draftSource, setDraftSource] = useState<"live" | "fixture" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeBack, setWriteBack] = useState<ApproveResponse | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  // Guarded by a ref as well as the disabled button: each write creates a
  // QuestionnaireResponse, a ClinicalImpression and a Task, so a double-click
  // that slips through duplicates three resources on a patient's chart. That is
  // not a UI glitch anyone can undo from here.
  const approveInFlight = useRef(false);

  useEffect(() => {
    // Fetched through a route rather than subscribed to from the browser: RLS
    // is on for clinical_drafts with no policies, so the publishable-key client
    // reads nothing. That is the same wall that got #16 cut, and it applies to
    // the Realtime subscription the old TODO here described.
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(
          `/api/clinician/draft?sessionId=${encodeURIComponent(params.sessionId)}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`Could not load this draft (${response.status})`);

        const body = (await response.json()) as {
          draft: ClinicalDraft;
          source: "live" | "fixture";
        };
        setDraft(body.draft);
        setDraftSource(body.source);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setLoadError(caught instanceof Error ? caught.message : "Could not load this draft");
      }
    })();

    return () => controller.abort();
  }, [params.sessionId]);

  async function approve() {
    if (approveInFlight.current) return;
    approveInFlight.current = true;
    setIsApproving(true);
    setApproveError(null);

    try {
      const response = await fetch("/api/clinician/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: params.sessionId }),
      });

      // The body carries the created resource ids and the source they came from.
      // Read before response.ok is checked so the error branch can quote the
      // reason instead of leaving the button looking broken.
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setApproveError(
          (typeof body?.error === "string" && body.error) ||
            `The write-back failed (HTTP ${response.status}).`
        );
        return;
      }

      setWriteBack(body as ApproveResponse);
      setDraft((prev) => (prev ? { ...prev, clinicianStatus: "approved" } : prev));
    } catch {
      setApproveError("Could not reach the server to save this draft.");
    } finally {
      approveInFlight.current = false;
      setIsApproving(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="mb-2 text-sm font-medium text-blue-700">Clinician review</p>

      {/* Never blank while loading — the go/no-go bar is that no screen waits
          more than two seconds without progress UI. */}
      {!draft && !loadError && (
        <p className="text-sm text-muted-foreground">Loading this session&apos;s draft…</p>
      )}

      {loadError && (
        <p className="text-sm text-red-600">
          {loadError}. Reload to try again — nothing has been written to the chart.
        </p>
      )}

      {draft && (
        <>
          {/* Provenance, held to the same bar as every sponsor adapter: say
              which draft this is before a clinician acts on it. */}
          {draftSource === "fixture" && (
            <p className="mb-4 text-sm text-amber-700">
              No draft has been saved for this session yet. The brief below is the scripted
              demo fixture, shown for reference only.
            </p>
          )}

          <ClinicianBrief
            draft={draft}
            onApprove={approve}
            writeBack={writeBack}
            approveError={approveError}
            isApproving={isApproving}
            // Approving a fixture would write this session's *empty* draft to the
            // chart while the screen shows Maya's — `api/clinician/approve` reads
            // the row itself and sends `chief_concern ?? ""`. Refusing is the
            // point of #30: never approve something other than what is displayed.
            approveBlockedReason={
              draftSource === "fixture"
                ? "This session has no saved draft, so it cannot be approved."
                : null
            }
          />
        </>
      )}
    </main>
  );
}
