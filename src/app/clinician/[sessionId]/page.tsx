"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ClinicianBrief } from "@/components/clinician-brief";
import { demoClinicalDraft } from "@/lib/demo-fixtures";
import type { ClinicalDraft } from "@/types";

export default function ClinicianReviewPage() {
  const params = useParams<{ sessionId: string }>();
  const [draft, setDraft] = useState<ClinicalDraft>({
    ...demoClinicalDraft,
    sessionId: params.sessionId,
  });

  useEffect(() => {
    // TODO: replace with a Supabase Realtime subscription on clinical_drafts
    // filtered by session_id once the live agent path populates real drafts.
  }, [params.sessionId]);

  async function approve() {
    const response = await fetch("/api/clinician/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: params.sessionId }),
    });
    if (response.ok) {
      setDraft((prev) => ({ ...prev, clinicianStatus: "approved" }));
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="mb-2 text-sm font-medium text-blue-700">Clinician review</p>
      <ClinicianBrief draft={draft} onApprove={approve} />
    </main>
  );
}
