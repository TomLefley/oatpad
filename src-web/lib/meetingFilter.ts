import type { MeetingSummary } from "./meetings";
import { ymdLocal } from "./calendar";

export type SearchMode = "text" | "date";

export function labelFor(title: string): string {
  return title.trim() || "meeting";
}

// Sidebar filter logic. In date mode, an unset rangeStart means "all
// meetings"; a set rangeStart with no rangeEnd is a single-day filter; a
// set rangeStart and rangeEnd is an inclusive range. In text mode, an
// empty query means "all meetings". YMD strings (yyyy-mm-dd) compare
// lexicographically, which is what the range check exploits.
export function filterMeetings(
  meetings: MeetingSummary[],
  mode: SearchMode,
  query: string,
  rangeStart: string | null,
  rangeEnd: string | null,
): MeetingSummary[] {
  if (mode === "date") {
    if (!rangeStart) return meetings;
    const end = rangeEnd ?? rangeStart;
    return meetings.filter((m) => {
      const ymd = ymdLocal(new Date(m.createdAt));
      return ymd >= rangeStart && ymd <= end;
    });
  }
  const q = query.trim().toLowerCase();
  if (!q) return meetings;
  return meetings.filter((m) =>
    labelFor(m.title).toLowerCase().includes(q),
  );
}
