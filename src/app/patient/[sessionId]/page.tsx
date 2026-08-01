"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { PatientPortal } from "@/components/patient-portal";
import type { PatientOverview } from "@/types";

// The patient's own screen. Previously this rendered `demoClinicalDraft`
// hardcoded, ignored the session, and nothing linked to it — intake sent the
// patient to the clinician's brief instead.
export default function PatientPortalPage() {
  const params = useParams<{ sessionId: string }>();
  const [overview, setOverview] = useState<PatientOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/patient/overview?sessionId=${encodeURIComponent(params.sessionId)}`,
          { signal }
        );
        const body = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            (typeof body?.error === "string" && body.error) ||
              `Could not load your record (${response.status})`
          );
        }

        setOverview(body as PatientOverview);
        setLoadError(null);
      } catch (caught) {
        if (signal?.aborted) return;
        setLoadError(
          caught instanceof Error ? caught.message : "Could not load your record"
        );
      }
    },
    [params.sessionId]
  );

  useEffect(() => {
    const controller = new AbortController();
    // Wrapped rather than called directly, matching the clinician screen: the
    // state updates belong to the awaited response, not to the effect body.
    void (async () => {
      await load(controller.signal);
    })();
    return () => controller.abort();
  }, [load]);

  // Filing a request creates a Task in Medplum; re-reading is what makes it
  // appear in the list, since the list comes from Medplum too.
  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const isFixture = overview !== null && overview.source !== "live";

  // Wider than the max-w-2xl this screen used when it was a single summary
  // card — it now carries tabbed record sections. Eyebrow and heading follow
  // the pair the other screens use, so it reads as one product.
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.12em] text-primary uppercase">
            Your health record
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
            {overview?.patient.name ?? "Loading…"}
          </h1>
          {overview && (
            <p className="mt-1 text-base text-muted-foreground">
              Age {overview.patient.age}
            </p>
          )}
        </div>

        {/* The operator still needs the brief in one click on stage. */}
        <Link
          className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
          href={`/clinician/${params.sessionId}`}
        >
          Clinician review →
        </Link>
      </div>

      {/* Never blank while loading — the go/no-go bar is that no screen waits
          more than two seconds without progress UI. */}
      {!overview && !loadError && (
        <p className="text-sm text-muted-foreground">Loading your record…</p>
      )}

      {loadError && (
        // No trailing period of our own — server messages already end in one,
        // and the result read as "…could not be filed.. Reload to try again".
        <p className="text-sm text-red-600">
          {loadError.replace(/\.?$/, ".")} Reload to try again — nothing has been changed.
        </p>
      )}

      {overview && (
        <>
          {isFixture && (
            // Same provenance rule as every adapter: say when what is on screen
            // is demo data rather than this patient's record.
            <Badge className="w-fit bg-amber-100 text-amber-900" variant="secondary">
              Showing demo data — not a live record
            </Badge>
          )}

          <PatientPortal
            overview={overview}
            sessionId={params.sessionId}
            onRefresh={refresh}
          />
        </>
      )}

      <p className="text-sm text-muted-foreground">
        Synthetic demo only. No diagnosis or treatment decision has been made, and your
        clinician reviews everything here before your visit.
      </p>
    </main>
  );
}
