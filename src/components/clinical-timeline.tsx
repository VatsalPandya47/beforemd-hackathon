"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SourceEvidence } from "@/components/source-evidence";
import { cn } from "@/lib/utils";
import type { KeyConnection, TimelineEntry } from "@/types";

// Reveal choreography for Screen 3 (doc section 8): entries land in
// chronological order, then a connector draws between the two events named in
// keyConnection.evidenceSourceIds and labels the gap between them — so the
// timing correlation reads as the finding (doc section 2) rather than as
// another list item.
//
// The connected pair is derived from evidenceSourceIds, never hardcoded to the
// medication/rash fixture, so this keeps working once Kashish's real Medplum
// resources replace demoClinicalDraft and the draft names different evidence.
//
// Timings are CSS animation-delays rather than JS timers: no cleanup to leak,
// and the sequence is identical on every replay.
const ENTRY_STAGGER_MS = 350;
const ENTRY_DURATION_MS = 500;
const CONNECTOR_GAP_MS = 150;
const CONNECTOR_DURATION_MS = 800;
const BADGE_OFFSET_MS = 500;
const INSIGHT_GAP_MS = 150;

type ConnectorGeometry = { top: number; height: number };

function entryKey(entry: TimelineEntry): string {
  return `${entry.sourceType}-${entry.sourceId}`;
}

// Layout offset, walking offsetParent instead of getBoundingClientRect: the
// entries animate with a translateY, and rect-based measurement would capture
// those in-flight transforms and mis-place the connector.
function offsetTopWithin(element: HTMLElement, ancestor: HTMLElement): number {
  let total = 0;
  let node: HTMLElement | null = element;
  while (node && node !== ancestor) {
    total += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return total;
}

function calendarDayGap(fromDate: string, toDate: string): number | null {
  const start = parseISO(fromDate);
  const end = parseISO(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const days = differenceInCalendarDays(end, start);
  return days > 0 ? days : null;
}

export function ClinicalTimeline({
  entries,
  keyConnection,
  revealKey = 0,
}: {
  entries: TimelineEntry[];
  keyConnection: KeyConnection;
  /** Change to replay the reveal from the top — e.g. from replay mode. */
  revealKey?: number | string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const dotRefs = useRef(new Map<string, HTMLSpanElement>());
  const [connector, setConnector] = useState<ConnectorGeometry | null>(null);

  // Entries keep their given order, so the first match is the earlier event and
  // the connector always draws downward.
  const linked = entries.filter((entry) =>
    (keyConnection?.evidenceSourceIds ?? []).includes(entry.sourceId)
  );
  const fromId = linked.length >= 2 ? linked[0].sourceId : null;
  const toId = linked.length >= 2 ? linked[linked.length - 1].sourceId : null;
  const dayGap =
    linked.length >= 2
      ? calendarDayGap(linked[0].date, linked[linked.length - 1].date)
      : null;

  const measure = useCallback(() => {
    const list = listRef.current;
    const fromDot = fromId ? dotRefs.current.get(fromId) : undefined;
    const toDot = toId ? dotRefs.current.get(toId) : undefined;

    if (!list || !fromDot || !toDot) {
      setConnector(null);
      return;
    }

    const top = offsetTopWithin(fromDot, list) + fromDot.offsetHeight / 2;
    const bottom = offsetTopWithin(toDot, list) + toDot.offsetHeight / 2;
    if (bottom <= top) {
      setConnector(null);
      return;
    }

    const next = { top, height: bottom - top };
    setConnector((prev) =>
      prev && prev.top === next.top && prev.height === next.height ? prev : next
    );
  }, [fromId, toId]);

  useLayoutEffect(() => {
    measure();
  }, [measure, revealKey, entries.length]);

  // Font loading and window resizing both move the dots after first paint; the
  // demo gets projected on an unknown screen, so re-measure rather than trust
  // the mount-time geometry.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure]);

  const lastEntryEnd =
    entries.length > 0
      ? (entries.length - 1) * ENTRY_STAGGER_MS + ENTRY_DURATION_MS
      : 0;
  const connectorDelay = lastEntryEnd + CONNECTOR_GAP_MS;
  const badgeDelay = connectorDelay + BADGE_OFFSET_MS;
  const insightDelay = connector
    ? connectorDelay + CONNECTOR_DURATION_MS + INSIGHT_GAP_MS
    : lastEntryEnd + INSIGHT_GAP_MS;

  return (
    <div className="flex flex-col gap-6">
      <ol
        key={`timeline-${revealKey}`}
        ref={listRef}
        className="relative flex flex-col gap-6 border-l-2 border-blue-200 pl-6"
      >
        {connector && (
          <span
            aria-hidden
            className="bmd-timeline-draw absolute -left-[3px] w-1 rounded-full bg-gradient-to-b from-blue-500 to-blue-600"
            style={{
              top: connector.top,
              height: connector.height,
              animationDelay: `${connectorDelay}ms`,
            }}
          />
        )}

        {entries.map((entry, index) => {
          const isLinked = entry.sourceId === fromId || entry.sourceId === toId;
          const carriesGapBadge = entry.sourceId === toId && dayGap !== null;

          return (
            <li
              key={entryKey(entry)}
              className={cn(
                "bmd-timeline-entry relative",
                // Opens the space the gap badge sits in, so the badge can never
                // land on top of an entry's text.
                carriesGapBadge && "mt-8"
              )}
              style={{ animationDelay: `${index * ENTRY_STAGGER_MS}ms` }}
            >
              <span
                ref={(node) => {
                  if (node) dotRefs.current.set(entry.sourceId, node);
                  return () => {
                    dotRefs.current.delete(entry.sourceId);
                  };
                }}
                className={cn(
                  "absolute -left-[29px] top-1 size-3 rounded-full bg-blue-600",
                  isLinked && "ring-4 ring-blue-100"
                )}
              >
                {isLinked && (
                  <span
                    aria-hidden
                    className="bmd-timeline-pulse absolute inset-0 rounded-full bg-blue-500"
                    style={{ animationDelay: `${connectorDelay}ms` }}
                  />
                )}
              </span>

              {carriesGapBadge && (
                <span
                  className="bmd-timeline-pop absolute -top-8 left-0 inline-flex items-center rounded-full border border-blue-200 bg-white px-3 py-1 text-sm font-semibold text-blue-800 shadow-sm"
                  style={{ animationDelay: `${badgeDelay}ms` }}
                >
                  {dayGap} days later
                </span>
              )}

              <p className="text-sm font-medium text-slate-500">{entry.date}</p>
              <p
                className={cn(
                  // One step up across the board: the timeline is the centrepiece
                  // of the reveal and gets read from the back of the room.
                  "text-base font-medium text-slate-900",
                  isLinked && "text-lg font-semibold text-blue-950"
                )}
              >
                {entry.label}
              </p>
              <div className="mt-1">
                <SourceEvidence
                  sourceType={entry.sourceType}
                  sourceId={entry.sourceId}
                  label="View source"
                />
              </div>
            </li>
          );
        })}
      </ol>

      {keyConnection && (
        <Card
          key={`insight-${revealKey}`}
          className="bmd-timeline-pop border-blue-200 bg-blue-50"
          style={{ animationDelay: `${insightDelay}ms` }}
        >
          <CardHeader>
            <CardTitle className="text-lg text-blue-900">Key insight — for clinician review</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {/* The demo's whole reveal is this sentence, so it is the largest
                body text on the screen. */}
            <p className="text-lg leading-relaxed text-blue-950">{keyConnection.statement}</p>
            <p className="text-sm font-medium tracking-wide text-blue-700 uppercase">
              Confidence: {keyConnection.confidence}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
