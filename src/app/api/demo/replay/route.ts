import { NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { demoReplayTurns } from "@/lib/demo-fixtures";
import type { AgentEvent, TranscriptEvent, TranscriptSpeaker } from "@/types";

const ReplaySchema = z.object({ sessionId: z.string().uuid() });

// Fallback ladder entry (doc section 10): streams a session's committed
// transcript AND agent events back in the order they happened, so the demo can
// recover if the live voice or agent path fails mid-run.
//
// Three-branch ladder, same shape as every sponsor adapter (`src/lib/integrations/*`):
// committed rows when Supabase has them, the demo fixture otherwise. The client
// is told which it got as provenance only — it renders both identically. The
// fixture branch is what lets the go/no-go line "run replay mode with the
// network otherwise disconnected" (#20) pass at all; the previous version of
// this route could only replay a session that had already been run live.

/**
 * Pacing comes from the real gaps between committed events, then clamped. Raw
 * gaps are wrong in both directions on stage: a live run has multi-second
 * pauses where the patient was thinking (dead air, and it trips the "no screen
 * waits silently more than two seconds" bar) and sub-50ms bursts where one
 * turn's tool events were inserted together (illegible).
 */
const MIN_GAP_MS = 250;
const MAX_GAP_MS = 1200;
/** A beat before the first line, so replay visibly starts rather than blinking in. */
const LEAD_IN_MS = 400;

/**
 * How long the committed-rows read gets before replay gives up and uses the
 * fixture. This is not a safety net, it is the point of the ladder: replay is
 * reached for when something is already broken on stage, and postgrest-js
 * retries failed GETs with exponential backoff (1s, 2s, 4s — measured at 7.5s
 * to first frame against an unreachable Supabase). Seven silent seconds is
 * itself a go/no-go failure, so the read is bounded and anything slower is
 * treated as unreachable.
 *
 * 800ms leaves the whole fallback path — deadline, request overhead, lead-in —
 * under the two-second bar, against a healthy read measured at ~120ms. If a
 * production read ever does exceed it, the cost is a labelled fixture replay
 * instead of the recorded one, which is the right way to lose.
 */
const READ_TIMEOUT_MS = 800;

type ReplayFrame =
  | { type: "transcript"; at: number; event: TranscriptEvent }
  | { type: "agent"; at: number; event: AgentEvent };

type TranscriptRow = {
  id: number;
  speaker: string;
  text: string;
  is_final: boolean;
  sequence_no: number;
  created_at: string;
};

type AgentRow = {
  id: number;
  event_type: string;
  tool_name: string | null;
  title: string;
  payload: Record<string, unknown> | null;
  sequence_no: number;
  created_at: string;
};

function committedFrames(
  sessionId: string,
  transcriptRows: TranscriptRow[],
  agentRows: AgentRow[]
): ReplayFrame[] {
  const frames: ReplayFrame[] = [
    ...transcriptRows.map<ReplayFrame>((row) => ({
      type: "transcript",
      at: Date.parse(row.created_at),
      event: {
        id: row.id,
        sessionId,
        speaker: row.speaker as TranscriptSpeaker,
        text: row.text,
        isFinal: row.is_final,
        sequenceNo: row.sequence_no,
        createdAt: row.created_at,
      },
    })),
    ...agentRows.map<ReplayFrame>((row) => ({
      type: "agent",
      at: Date.parse(row.created_at),
      event: {
        id: row.id,
        sessionId,
        eventType: row.event_type as AgentEvent["eventType"],
        toolName: row.tool_name,
        title: row.title,
        payload: row.payload ?? {},
        sequenceNo: row.sequence_no,
        createdAt: row.created_at,
      },
    })),
  ];

  // Chronological, because the two tables have independent sequence_no
  // counters — agent_events restarts at 0 every turn, so it cannot order the
  // merged stream. Ties break transcript-first: `api/agent/turn` commits the
  // reply row before that turn's tool events.
  return frames.sort(
    (a, b) => a.at - b.at || (a.type === b.type ? 0 : a.type === "transcript" ? -1 : 1)
  );
}

/**
 * Expands `demoReplayTurns` into the frame shape a live run commits, with
 * synthetic timestamps chosen to give a natural rhythm once clamped.
 */
function fixtureFrames(sessionId: string): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  let at = Date.parse("2026-08-01T17:00:00.000Z");
  let transcriptSeq = 0;
  let id = 1;

  const transcript = (speaker: TranscriptSpeaker, text: string) => {
    frames.push({
      type: "transcript",
      at,
      event: {
        id: id++,
        sessionId,
        speaker,
        text,
        isFinal: true,
        sequenceNo: transcriptSeq++,
        createdAt: new Date(at).toISOString(),
      },
    });
  };

  for (const turn of demoReplayTurns) {
    transcript("patient", turn.patient);
    at += 900;

    let toolSeq = 0;
    for (const tool of turn.tools) {
      for (const [eventType, title] of [
        ["tool_started", tool.startedTitle],
        ["tool_completed", tool.completedTitle],
      ] as const) {
        frames.push({
          type: "agent",
          at,
          event: {
            id: id++,
            sessionId,
            eventType,
            toolName: tool.toolName,
            title,
            payload: {},
            sequenceNo: toolSeq++,
            createdAt: new Date(at).toISOString(),
          },
        });
        at += 450;
      }
    }

    transcript("agent", turn.agent);
    at += 1100;
  }

  return frames;
}

export async function POST(request: NextRequest) {
  const parsed = ReplaySchema.safeParse(await request.json());
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400 });
  }
  const { sessionId } = parsed.data;

  let frames: ReplayFrame[] = [];
  let source: "live" | "fixture" = "fixture";

  // A replay that throws — or stalls — is a replay that cannot rescue the demo,
  // so a Supabase failure degrades to the fixture instead of returning 500, and
  // a slow Supabase is treated the same as a broken one.
  try {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), READ_TIMEOUT_MS);

    const supabase = createAdminClient();
    const read = Promise.all([
      supabase
        .from("transcript_events")
        .select("id, speaker, text, is_final, sequence_no, created_at")
        .eq("session_id", sessionId)
        .order("sequence_no", { ascending: true })
        .abortSignal(abort.signal),
      supabase
        .from("agent_events")
        .select("id, event_type, tool_name, title, payload, sequence_no, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
        .abortSignal(abort.signal),
    ]);

    // The abort signal alone is not enough: postgrest-js sleeps between retries,
    // so the race is what guarantees the deadline is actually honoured.
    const settled = await Promise.race([
      read,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ]);
    clearTimeout(timeout);

    if (settled) {
      const [transcript, agent] = settled;
      if (!transcript.error && (transcript.data?.length ?? 0) > 0) {
        frames = committedFrames(
          sessionId,
          (transcript.data ?? []) as TranscriptRow[],
          // Losing only the agent events still leaves a replayable transcript.
          agent.error ? [] : ((agent.data ?? []) as AgentRow[])
        );
        source = "live";
      }
    }
  } catch {
    // Fall through to the fixture.
  }

  if (frames.length === 0) {
    frames = fixtureFrames(sessionId);
    source = "fixture";
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      // Provenance first, so the UI can label the run before any line lands.
      send({ type: "meta", source, total: frames.length });

      let previousAt: number | null = null;

      for (const frame of frames) {
        const wait =
          previousAt === null
            ? LEAD_IN_MS
            : Math.min(Math.max(frame.at - previousAt, MIN_GAP_MS), MAX_GAP_MS);

        // The patient closing the tab should not leave this loop ticking.
        if (request.signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, wait));
        if (request.signal.aborted) break;

        send({ type: frame.type, event: frame.event });
        previousAt = frame.at;
      }

      if (!request.signal.aborted) send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
