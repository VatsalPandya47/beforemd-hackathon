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
        <p className="text-sm font-medium text-blue-700">Your visit prep</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          What we documented
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">In plain language</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-700">{draft.patientFriendlySummary}</p>
        </CardContent>
      </Card>

      {draft.coverageSummary && <CoverageCard coverage={draft.coverageSummary} />}

      <p className="text-xs text-muted-foreground">
        No diagnosis or treatment decision has been made. Your clinician will review
        this draft before your visit.
      </p>
    </main>
  );
}
