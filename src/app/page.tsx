import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// Marketing entry point — a judge or reviewer hitting the production URL cold
// needs the pitch before the tool. The actual product starts at /dashboard.
// Copy is pulled verbatim from docs/pitch.md and docs/submission-package.md
// rather than freshly written, so this page can never say something the team
// hasn't already committed to saying out loud.

const TECHNOLOGY = [
  { name: "Medplum", role: "FHIR source of truth — patient, encounter, medication, and document records" },
  { name: "Deepgram", role: "Real-time voice for the pre-visit conversation" },
  { name: "Moss", role: "Retrieves relevant supporting context from the chart" },
  { name: "Stedi", role: "Checks insurance eligibility and coverage" },
  { name: "Supabase", role: "Coordinates live session state, realtime-synced to the clinician's screen" },
];

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-8 py-6">
        <p className="text-sm font-semibold tracking-[0.12em] text-primary uppercase">
          BeforeMD
        </p>
        <a
          href="https://github.com/VatsalPandya47/beforemd-hackathon"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          GitHub
        </a>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-8 py-16">
        <p className="text-sm font-semibold tracking-[0.12em] text-primary uppercase">
          Voice-first pre-visit intelligence
        </p>
        <h1 className="mt-3 text-4xl leading-tight font-semibold tracking-tight text-slate-900 sm:text-5xl">
          Every visit starts with a story the chart already knows.
          <br />
          BeforeMD tells it before the doctor walks in.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          A voice-first pre-visit agent that understands a patient&apos;s
          longitudinal history, asks the missing questions, and prepares a
          sourced clinical brief before the appointment begins.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/dashboard"
            className={buttonVariants({ size: "lg", className: "h-12 gap-2 px-6 text-base" })}
          >
            View live demo
            <ArrowRightIcon className="size-4" />
          </Link>
          <a
            href="#how-it-works"
            className={buttonVariants({
              variant: "outline",
              size: "lg",
              className: "h-12 px-6 text-base",
            })}
          >
            How it works
          </a>
        </div>
      </section>

      <section className="border-t border-border bg-white py-16">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-8 sm:grid-cols-2">
          <div>
            <p className="text-sm font-semibold tracking-[0.1em] text-primary uppercase">
              The problem
            </p>
            <p className="mt-3 text-lg leading-relaxed text-slate-800">
              Doctors spend the beginning of every visit reconstructing a
              story that already exists — scattered across notes,
              medications, patient memory, and insurance systems. Fixed
              intake forms don&apos;t adapt to prior history, and
              documentation starts after the conversation, not during it.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold tracking-[0.1em] text-primary uppercase">
              The product
            </p>
            <p className="mt-3 text-lg leading-relaxed text-slate-800">
              BeforeMD runs a voice-first pre-visit conversation that adapts
              to the patient&apos;s actual chart. It asks the missing
              questions, connects the patient&apos;s longitudinal history,
              checks insurance coverage, and prepares a structured, sourced
              draft — not a diagnosis — with every claim traceable back to a
              specific record.
            </p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-16">
        <div className="mx-auto w-full max-w-5xl px-8">
          <p className="text-sm font-semibold tracking-[0.1em] text-primary uppercase">
            How it works
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TECHNOLOGY.map((tech) => (
              <Card key={tech.name} className="gap-2 py-5">
                <CardContent className="flex flex-col gap-1">
                  <p className="text-base font-semibold text-slate-900">{tech.name}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{tech.role}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-white py-16">
        <div className="mx-auto w-full max-w-3xl px-8">
          <p className="text-sm font-semibold tracking-[0.1em] text-primary uppercase">
            Built for clinical trust
          </p>
          <p className="mt-3 text-lg leading-relaxed text-slate-800">
            BeforeMD doesn&apos;t diagnose or prescribe. It separates what the
            patient said from what the chart says, shows its sources, screens
            for urgent red flags, and keeps the clinician in control. Every
            generated draft is explicitly labeled unverified until a
            clinician takes the separate, explicit approve action.
          </p>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-5xl px-8 py-10">
        <Separator className="mb-6" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm text-muted-foreground">
            All demo data is synthetic — no real patients, records, or
            identifiers. Built for the YC × Medplum Agentic Healthcare
            Hackathon.
          </p>
          <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
            View live demo →
          </Link>
        </div>
      </footer>
    </main>
  );
}
