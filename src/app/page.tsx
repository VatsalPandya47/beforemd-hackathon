"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { demoIds } from "@/lib/flags";
import { DEMO_PATIENT_NAME } from "@/lib/demo-fixtures";

const SPONSOR_STATUS = ["Medplum", "Deepgram", "Moss", "Stedi"];

export default function ClinicianDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemo() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientFhirId: demoIds.patientFhirId || "DEMO_PATIENT_FHIR_ID",
          mode: "live",
        }),
      });
      if (!response.ok) throw new Error("Failed to start session");
      const { sessionId } = await response.json();
      router.push(`/intake/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 p-8">
      <div>
        <p className="text-sm font-medium text-blue-700">BeforeMD</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Clinician dashboard
        </h1>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{DEMO_PATIENT_NAME}</CardTitle>
          <Badge variant="secondary">Pre-visit intake not started</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Upcoming dermatology appointment. Start the voice pre-visit intake to
            prepare a sourced brief before the visit.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <Button onClick={startDemo} disabled={loading}>
            {loading ? "Starting..." : "Start patient demo"}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardFooter>
      </Card>

      <div className="flex items-center gap-2">
        {SPONSOR_STATUS.map((name) => (
          <Badge key={name} variant="outline">
            {name}
          </Badge>
        ))}
      </div>
    </main>
  );
}
