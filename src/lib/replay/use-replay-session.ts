"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, TranscriptEvent } from "@/types";

// Client half of the replay rung of the fallback ladder (issue #18). Consumes
// the SSE stream from `POST /api/demo/replay` and hands each frame back to the
// page, which appends it to exactly the same transcript and activity-rail state
// a live run writes — so replayed and live runs are indistinguishable on screen
// apart from the provenance badge.
//
// This uses `fetch` + a body reader rather than `EventSource`: EventSource is
// GET-only and cannot send the session id in a body, and the route is a POST
// alongside the rest of the API surface.

export type ReplayPhase = "idle" | "connecting" | "playing" | "done" | "error";

/** Where the replayed events came from — displayed as provenance, never branched on. */
export type ReplaySource = "live" | "fixture";

export type ReplayFrame =
  | { type: "transcript"; event: TranscriptEvent }
  | { type: "agent"; event: AgentEvent };

type ServerFrame =
  | { type: "meta"; source: ReplaySource; total: number }
  | { type: "done" }
  | ReplayFrame;

export type UseReplaySession = {
  phase: ReplayPhase;
  source: ReplaySource | null;
  error: string | null;
  /** True while a replay is connecting or playing — the page locks live input during that. */
  active: boolean;
  start: () => void;
  stop: () => void;
};

export function useReplaySession({
  sessionId,
  onBegin,
  onFrame,
}: {
  sessionId: string;
  /** Called once, before the first frame, so the page can clear what is on screen. */
  onBegin: () => void;
  onFrame: (frame: ReplayFrame) => void;
}): UseReplaySession {
  const [phase, setPhase] = useState<ReplayPhase>("idle");
  const [source, setSource] = useState<ReplaySource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const onBeginRef = useRef(onBegin);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onBeginRef.current = onBegin;
    onFrameRef.current = onFrame;
  });

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase((current) => (current === "connecting" || current === "playing" ? "idle" : current));
  }, []);

  const start = useCallback(() => {
    // Restarting mid-replay is a legitimate stage move; drop the old stream.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setSource(null);
    setPhase("connecting");
    onBeginRef.current();

    void (async () => {
      try {
        const response = await fetch("/api/demo/replay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Replay could not start (${response.status})`);
        }

        setPhase("playing");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line. Anything after the last
          // separator is a partial frame and stays in the buffer.
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            const data = block
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("");
            if (!data) continue;

            const frame = JSON.parse(data) as ServerFrame;
            if (frame.type === "meta") {
              setSource(frame.source);
            } else if (frame.type === "done") {
              setPhase("done");
            } else {
              onFrameRef.current(frame);
            }
          }
        }

        // The stream ending without a `done` frame means it was cut short.
        setPhase((current) => (current === "done" ? current : "idle"));
      } catch (caught) {
        // An abort is the operator stopping replay, not a failure.
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Replay failed");
        setPhase("error");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    })();
  }, [sessionId]);

  // Leaving the page mid-replay should close the stream, not keep it ticking.
  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    phase,
    source,
    error,
    active: phase === "connecting" || phase === "playing",
    start,
    stop,
  };
}
