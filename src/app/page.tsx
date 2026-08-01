"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_PATIENT_NAME } from "@/lib/demo-fixtures";

// Doc section 8 asks for sponsor visibility as small native labels rather than a
// logo wall. Everywhere else in the app that means the label sits on the thing it
// produced — the Deepgram mode badge on intake, "Written to Medplum" on the
// clinician brief, "Eligibility checked with Stedi" on the coverage card. This
// screen has produced nothing yet, so it names what each one will do, on one
// quiet line, instead of a row of four badges that assert nothing.
const SPONSOR_ROLES = [
  "Chart by Medplum",
  "Voice by Deepgram",
  "Context by Moss",
  "Eligibility by Stedi",
];

export default function ClinicianDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemo() {
    setLoading(true);
    setError(null);
    try {
      // No patientFhirId: this is a client component, so it cannot read
      // DEMO_PATIENT_FHIR_ID (not NEXT_PUBLIC_ — it is absent from the browser
      // bundle, and the old `demoIds.patientFhirId || "DEMO_PATIENT_FHIR_ID"`
      // always took the fallback and started every session on a patient that
      // does not exist). The route fills it in from the server env instead.
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "live" }),
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
        <p className="text-sm font-semibold tracking-[0.12em] text-primary uppercase">
          BeforeMD
        </p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight text-slate-900">
          Clinician dashboard
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Pre-visit intelligence, prepared before the appointment.
        </p>
      </div>

      <Card className="py-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-2xl">{DEMO_PATIENT_NAME}</CardTitle>
          <Badge variant="secondary">Pre-visit intake not started</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-base leading-relaxed text-muted-foreground">
            Upcoming dermatology appointment. Start the voice pre-visit intake to
            prepare a sourced brief before the visit.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          {/* The primitive's own `lg` is h-9/text-sm, which is a toolbar button.
              The one control that starts the demo is sized for the room. */}
          <Button size="lg" className="h-12 text-base" onClick={startDemo} disabled={loading}>
            {loading ? "Starting…" : "Start patient demo"}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardFooter>
      </Card>

      <p className="text-sm text-muted-foreground">{SPONSOR_ROLES.join(" · ")}</p>
    </main>
  );
}
