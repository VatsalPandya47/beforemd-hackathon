"use client";

import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverageCard } from "@/components/coverage-card";
import { demoClinicalDraft } from "@/lib/demo-fixtures";

export default function PatientSummaryPage() {
  const params = useParams<{ sessionId: string }>();
  const draft = { ...demoClinicalDraft, sessionId: params.sessionId };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <p className="text-sm font-semibold tracking-[0.12em] text-primary uppercase">
          Your visit prep
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
          What we documented
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">In plain language</CardTitle>
        </CardHeader>
        <CardContent>
          {/* The patient reads this one on a phone at arm's length; it is the
              screen's whole payload, so it gets the largest body size. */}
          <p className="text-lg leading-relaxed text-slate-700">
            {draft.patientFriendlySummary}
          </p>
        </CardContent>
      </Card>

      {draft.coverageSummary && <CoverageCard coverage={draft.coverageSummary} />}

      <p className="text-sm text-muted-foreground">
        No diagnosis or treatment decision has been made. Your clinician will review
        this draft before your visit.
      </p>
    </main>
  );
}
