import type { MeetingSummary } from "./meetings";
import { ymdLocal } from "./calendar";

export type SearchMode = "text" | "date";

export function labelFor(title: string): string {
  return title.trim() || "meeting";
}

// Sidebar filter logic. In date mode, an unset selection means "all
// meetings"; in text mode, an empty query likewise means "all meetings".
export function filterMeetings(
  meetings: MeetingSummary[],
  mode: SearchMode,
  query: string,
  selectedDate: string | null,
): MeetingSummary[] {
  if (mode === "date") {
    if (!selectedDate) return meetings;
    return meetings.filter(
      (m) => ymdLocal(new Date(m.createdAt)) === selectedDate,
    );
  }
  const q = query.trim().toLowerCase();
  if (!q) return meetings;
  return meetings.filter((m) =>
    labelFor(m.title).toLowerCase().includes(q),
  );
}
