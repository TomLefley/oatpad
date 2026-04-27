import type { OatsEvent } from "./types";

// Combines committed edit events with live keystroke markers to produce the
// effective first-edit and last-edit timestamps shown in MeetingMeta.
// Bookkeeping events (`session_started`, `file_loaded`) are excluded.
export function editBounds(
  events: readonly OatsEvent[],
  firstInputAt: string | null,
  lastInputAt: string | null,
): { first: string | null; last: string | null } {
  let first: string | null = null;
  let last: string | null = null;
  for (const e of events) {
    if (
      e.type === "note_created" ||
      e.type === "note_edited" ||
      e.type === "note_deleted"
    ) {
      if (!first || e.ts < first) first = e.ts;
      if (!last || e.ts > last) last = e.ts;
    }
  }
  if (firstInputAt && (!first || firstInputAt < first)) first = firstInputAt;
  if (lastInputAt && (!last || lastInputAt > last)) last = lastInputAt;
  return { first, last };
}

export type Phase = "none" | "live" | "idle" | "ended";

// Phase progression after the most recent edit:
//   <1m   → live  (animated ellipsis)
//   1–3m  → idle  (static ellipsis)
//   ≥3m   → ended (real end timestamp)
// `elapsedMs` < 0 is treated as 0 so a clock-skewed last-edit doesn't
// flip the UI to ended.
export function phaseFor(
  elapsedMs: number,
  hasLastEdit: boolean,
): Phase {
  if (!hasLastEdit) return "none";
  const e = Math.max(0, elapsedMs);
  if (e < 60_000) return "live";
  if (e < 180_000) return "idle";
  return "ended";
}
