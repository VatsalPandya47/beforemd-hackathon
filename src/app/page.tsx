import Link from "next/link";
import { ArrowRightIcon, DatabaseIcon, FileTextIcon, MicIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Reveal } from "@/components/reveal";

// Marketing entry point for a judge or reviewer hitting the production URL
// cold. The actual product starts at /dashboard. Copy is pulled from
// docs/pitch.md and docs/submission-package.md rather than freshly written,
// so this page can never say something the team hasn't already committed to
// saying out loud.

const TECHNOLOGY = [
  {
    name: "Medplum",
    role: "FHIR source of truth. Patient, encounter, medication, and document records.",
    icon: FileTextIcon,
  },
  {
    name: "Deepgram",
    role: "Real-time voice for the pre-visit conversation.",
    icon: MicIcon,
  },
  {
    name: "Moss",
    role: "Retrieves relevant supporting context from the chart.",
    icon: SearchIcon,
  },
  {
    name: "Stedi",
    role: "Checks insurance eligibility and coverage.",
    icon: ShieldCheckIcon,
  },
  {
    name: "Supabase",
    role: "Coordinates live session state, synced in real time to the clinician's screen.",
    icon: DatabaseIcon,
  },
];

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className={
        dark
          ? "inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3.5 py-1 text-xs font-semibold tracking-[0.14em] text-blue-200 uppercase"
          : "inline-flex items-center rounded-full border border-blue-900/10 bg-accent px-3.5 py-1 text-xs font-semibold tracking-[0.12em] text-primary uppercase"
      }
    >
      {children}
    </span>
  );
}

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <div className="bmd-hero-glow">
        <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-8 py-6">
          <p className="text-sm font-semibold tracking-[0.14em] text-white uppercase">
            BeforeMD
          </p>
          <a
            href="https://github.com/VatsalPandya47/beforemd-hackathon"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-white/70 transition-colors hover:text-white"
          >
            GitHub
          </a>
        </header>

        <section className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center px-8 pt-20 pb-28 text-center">
          <div className="bmd-hero-fade-1">
            <Eyebrow dark>Voice-first pre-visit intelligence</Eyebrow>
          </div>
          <h1 className="bmd-hero-fade-2 mt-6 text-5xl leading-[1.05] font-semibold tracking-tight text-white sm:text-6xl">
            Every visit starts with a
            <br />
            story the chart already knows.
          </h1>
          <p className="bmd-hero-fade-3 mt-6 max-w-xl text-lg leading-relaxed text-white/60">
            A voice-first pre-visit agent that understands a patient&apos;s
            longitudinal history, asks the missing questions, and prepares a
            sourced clinical brief before the appointment begins.
          </p>

          <div className="bmd-hero-fade-4 mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className={buttonVariants({
                size: "lg",
                className:
                  "h-12 gap-2 rounded-full bg-white px-7 text-base text-slate-900 transition-transform hover:-translate-y-0.5 hover:bg-white/90",
              })}
            >
              View live demo
              <ArrowRightIcon className="size-4" />
            </Link>
            <a
              href="#how-it-works"
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className:
                  "h-12 rounded-full border-white/15 bg-white/5 px-7 text-base text-white transition-transform hover:-translate-y-0.5 hover:bg-white/10",
              })}
            >
              How it works
            </a>
          </div>
        </section>
      </div>

      <section className="bg-white py-24">
        <Reveal className="mx-auto w-full max-w-3xl px-8 text-center">
          <p className="text-2xl leading-snug font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Doctors spend the beginning of every visit reconstructing a story
            that already exists. It is scattered across notes, medications,
            patient memory, and insurance systems. Fixed intake forms
            don&apos;t adapt to prior history, and documentation starts after
            the conversation, not during it.
          </p>
        </Reveal>
      </section>

      <section id="how-it-works" className="border-t border-border bg-slate-50 py-24">
        <div className="mx-auto w-full max-w-5xl px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <Eyebrow>How it works</Eyebrow>
            <p className="mt-4 text-lg leading-relaxed text-slate-800">
              BeforeMD runs a voice-first pre-visit conversation that adapts
              to the patient&apos;s actual chart. It asks the missing
              questions, connects the patient&apos;s longitudinal history,
              checks insurance coverage, and prepares a structured, sourced
              draft, not a diagnosis, with every claim traceable back to a
              specific record.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TECHNOLOGY.map((tech, index) => (
              <Reveal key={tech.name} delayMs={index * 80}>
                <Card className="group h-full gap-3 border-slate-200 bg-white py-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5">
                  <CardContent className="flex flex-col gap-3">
                    <span className="inline-flex size-10 items-center justify-center rounded-xl bg-accent text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <tech.icon className="size-5" />
                    </span>
                    <div className="flex flex-col gap-1.5">
                      <p className="text-base font-semibold text-slate-900">{tech.name}</p>
                      <p className="text-sm leading-relaxed text-muted-foreground">{tech.role}</p>
                    </div>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-white py-24">
        <Reveal className="mx-auto w-full max-w-3xl px-8 text-center">
          <Eyebrow>Built for clinical trust</Eyebrow>
          <p className="mt-4 text-lg leading-relaxed text-slate-800">
            BeforeMD doesn&apos;t diagnose or prescribe. It separates what the
            patient said from what the chart says, shows its sources, screens
            for urgent red flags, and keeps the clinician in control. Every
            generated draft is explicitly labeled unverified until a
            clinician takes the separate, explicit approve action.
          </p>
        </Reveal>
      </section>

      <footer className="mx-auto w-full max-w-6xl px-8 py-10">
        <Separator className="mb-6" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm text-muted-foreground">
            All demo data is synthetic. No real patients, records, or
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
