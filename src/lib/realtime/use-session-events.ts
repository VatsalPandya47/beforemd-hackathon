"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AgentEvent, AgentEventType, TranscriptEvent, TranscriptSpeaker } from "@/types";

// Two screens can watch one intake: the patient's, and a clinician (or the
// projector) following along. Committed rows reach this screen through Realtime
// rather than only through the fetch that caused them, so both converge on the
// same transcript and rail (#16).
//
// This hook deliberately does not own that state. The intake screen writes into
// it from three producers — the live turn, replay, and now Realtime — and only
// that screen knows which of them currently owns the display, so deltas are
// handed back as callbacks the way useReplaySession does and the merge helpers
// below stay pure.
//
// Requires the anon select policies from migration 003. postgres_changes
// enforces RLS against the subscribing role, so without them this subscribes
// successfully, reports SUBSCRIBED, and then never delivers a row.

export type SessionSyncStatus = "connecting" | "live" | "error";

/**
 * A transcript line as the screen holds it, with one client-only marker.
 *
 * `adopted` means this committed row replaced a line the screen was already
 * showing optimistically. Without it, a committed row that arrived on its own is
 * indistinguishable from one that replaced an optimistic entry — both simply
 * carry a positive id — and the two merges below need to tell them apart to stay
 * correct in both arrival orders.
 */
export type DisplayTranscriptEvent = TranscriptEvent & { adopted?: boolean };

// NEXT_PUBLIC_* values are inlined at build time, so this is a build-time
// constant. Checked rather than assumed because nothing used the browser client
// before this hook: an environment that only ever needed the server key would
// otherwise throw inside createBrowserClient and take the intake screen down on
// mount. Sync is the only thing allowed to fail here — the live turn path does
// not depend on it.
const CONFIGURED =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

export type SessionSync = {
  status: SessionSyncStatus;
  /** Set when status is "error"; safe to show in a tooltip. */
  error: string | null;
};

type TranscriptRow = {
  id: number;
  session_id: string;
  speaker: string;
  text: string;
  is_final: boolean;
  sequence_no: number;
  created_at: string;
};

type AgentRow = {
  id: number;
  session_id: string;
  event_type: string;
  tool_name: string | null;
  title: string;
  payload: Record<string, unknown> | null;
  sequence_no: number;
  created_at: string;
};

function toTranscriptEvent(row: TranscriptRow): TranscriptEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    speaker: row.speaker as TranscriptSpeaker,
    text: row.text,
    isFinal: row.is_final,
    sequenceNo: row.sequence_no,
    createdAt: row.created_at,
  };
}

function toAgentEvent(row: AgentRow): AgentEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    eventType: row.event_type as AgentEventType,
    toolName: row.tool_name,
    title: row.title,
    payload: row.payload ?? {},
    sequenceNo: row.sequence_no,
    createdAt: row.created_at,
  };
}

/**
 * Folds a committed transcript row into what is already on screen.
 *
 * The live path appends the patient's utterance and the agent's reply
 * optimistically, so the same line arrives twice: once locally, once from the
 * database. `api/agent/turn` does not return the ids it inserted for transcript
 * rows (it does for tool events), so a committed row adopts the first *pending*
 * local entry with the same speaker and text instead of appending a duplicate.
 *
 * Pending means a negative id, which the intake screen assigns to entries it has
 * not seen committed yet — database ids are always positive.
 *
 * Adopting the first pending match rather than matching by index is what makes a
 * repeated utterance behave: say "yes" twice and the first row adopts the first
 * entry, then the second row finds that one already carries a database id and
 * moves on to the second.
 */
export function mergeTranscriptEvent(
  events: DisplayTranscriptEvent[],
  incoming: TranscriptEvent
): DisplayTranscriptEvent[] {
  if (events.some((event) => event.id === incoming.id)) return events;

  const pending = events.findIndex(
    (event) =>
      event.id < 0 && event.speaker === incoming.speaker && event.text === incoming.text
  );
  // Unclaimed: nothing on screen was waiting for this row, so it is the first
  // time this line has been displayed. appendOptimisticEvent looks for that.
  if (pending === -1) return [...events, incoming];

  const next = events.slice();
  next[pending] = { ...incoming, adopted: true };
  return next;
}

/**
 * Appends a line the screen is showing before its row is committed — unless that
 * row has already arrived.
 *
 * Realtime and the fetch response race, and the fetch does not always win:
 * `api/agent/turn` inserts the patient's line and the agent's reply *before* it
 * responds, and then does more work (the draft upsert) before returning, so
 * against a hosted Supabase the committed row routinely lands first. Appending
 * blindly then shows the same line twice — the doubled agent greeting.
 *
 * When an unclaimed committed row is already present, this consumes it — marking
 * it adopted — instead of appending. Consuming rather than merely skipping is
 * what keeps a repeated utterance honest: answer "Yes" twice and the second
 * optimistic append finds the first row already adopted, so it appends its own
 * line and waits for its own row.
 */
export function appendOptimisticEvent(
  events: DisplayTranscriptEvent[],
  entry: DisplayTranscriptEvent
): DisplayTranscriptEvent[] {
  const committed = events.findIndex(
    (event) =>
      event.id > 0 &&
      !event.adopted &&
      event.speaker === entry.speaker &&
      event.text === entry.text
  );
  if (committed === -1) return [...events, entry];

  const next = events.slice();
  next[committed] = { ...next[committed], adopted: true };
  return next;
}

/**
 * Same idea for the activity rail. Tool events usually arrive already carrying
 * their database id — `api/agent/turn` maps the inserted ids back onto the
 * events it returns — so the id check does the work. The fallback matters only
 * when that insert returned an unexpected row count and the ids stayed 0, which
 * the route treats as non-fatal.
 */
export function mergeAgentEvent(events: AgentEvent[], incoming: AgentEvent): AgentEvent[] {
  if (events.some((event) => event.id === incoming.id)) return events;

  const pending = events.findIndex(
    (event) =>
      event.id <= 0 &&
      event.eventType === incoming.eventType &&
      event.toolName === incoming.toolName &&
      event.title === incoming.title
  );
  if (pending === -1) return [...events, incoming];

  const next = events.slice();
  next[pending] = incoming;
  return next;
}

export function useSessionEvents({
  sessionId,
  onHydrate,
  onTranscript,
  onAgentEvent,
}: {
  sessionId: string;
  /** Everything already committed for this session, in insertion order. */
  onHydrate: (rows: { transcript: DisplayTranscriptEvent[]; agentEvents: AgentEvent[] }) => void;
  onTranscript: (event: TranscriptEvent) => void;
  onAgentEvent: (event: AgentEvent) => void;
}): SessionSync {
  const [status, setStatus] = useState<SessionSyncStatus>(
    CONFIGURED ? "connecting" : "error"
  );
  const [error, setError] = useState<string | null>(
    CONFIGURED
      ? null
      : "Live sync is unavailable: this build has no Supabase browser credentials"
  );

  // Held in a ref so a new callback identity never tears down the subscription.
  const handlers = useRef({ onHydrate, onTranscript, onAgentEvent });
  useEffect(() => {
    handlers.current = { onHydrate, onTranscript, onAgentEvent };
  });

  useEffect(() => {
    if (!sessionId || !CONFIGURED) return;
    let cancelled = false;

    const supabase = createClient();

    async function hydrate() {
      const [transcript, agentEvents] = await Promise.all([
        supabase
          .from("transcript_events")
          .select("id, session_id, speaker, text, is_final, sequence_no, created_at")
          .eq("session_id", sessionId)
          .order("id", { ascending: true }),
        supabase
          .from("agent_events")
          .select("id, session_id, event_type, tool_name, title, payload, sequence_no, created_at")
          .eq("session_id", sessionId)
          .order("id", { ascending: true }),
      ]);

      if (cancelled) return;

      // Ordered by id, not sequence_no: transcript_events numbers per session
      // but agent_events restarts its counter every turn, and id is the one
      // monotonic column both share.
      if (transcript.error || agentEvents.error) {
        setStatus("error");
        setError(
          transcript.error?.message ??
            agentEvents.error?.message ??
            "Could not load this session's committed events"
        );
        return;
      }

      handlers.current.onHydrate({
        transcript: (transcript.data ?? []).map((row) => toTranscriptEvent(row as TranscriptRow)),
        agentEvents: (agentEvents.data ?? []).map((row) => toAgentEvent(row as AgentRow)),
      });
    }

    const channel = supabase
      .channel(`intake:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transcript_events",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (!cancelled) {
            handlers.current.onTranscript(toTranscriptEvent(payload.new as TranscriptRow));
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_events",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (!cancelled) {
            handlers.current.onAgentEvent(toAgentEvent(payload.new as AgentRow));
          }
        }
      )
      .subscribe((state) => {
        if (cancelled) return;

        if (state === "SUBSCRIBED") {
          setStatus("live");
          setError(null);
          // Hydrated after SUBSCRIBED rather than before: a row inserted in
          // between would otherwise be missed by both paths. Arriving twice is
          // harmless — both merges dedupe on the database id.
          void hydrate();
          return;
        }

        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          setStatus("error");
          setError(
            state === "TIMED_OUT"
              ? "Live sync timed out; this screen is showing its own turns only"
              : "Live sync could not connect; this screen is showing its own turns only"
          );
        }
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return { status, error };
}
