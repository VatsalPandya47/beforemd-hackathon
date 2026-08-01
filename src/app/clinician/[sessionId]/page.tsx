"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ClinicianBrief } from "@/components/clinician-brief";
import { demoClinicalDraft } from "@/lib/demo-fixtures";
import type { ApproveResponse, ClinicalDraft } from "@/types";

export default function ClinicianReviewPage() {
  const params = useParams<{ sessionId: string }>();
  const [draft, setDraft] = useState<ClinicalDraft>({
    ...demoClinicalDraft,
    sessionId: params.sessionId,
  });
  const [writeBack, setWriteBack] = useState<ApproveResponse | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  // Guarded by a ref as well as the disabled button: each write creates a
  // QuestionnaireResponse, a ClinicalImpression and a Task, so a double-click
  // that slips through duplicates three resources on a patient's chart. That is
  // not a UI glitch anyone can undo from here.
  const approveInFlight = useRef(false);

  useEffect(() => {
    // TODO: replace with a Supabase Realtime subscription on clinical_drafts
    // filtered by session_id once the live agent path populates real drafts.
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
      setDraft((prev) => ({ ...prev, clinicianStatus: "approved" }));
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
      <ClinicianBrief
        draft={draft}
        onApprove={approve}
        writeBack={writeBack}
        approveError={approveError}
        isApproving={isApproving}
      />
    </main>
  );
}
