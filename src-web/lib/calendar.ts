// Pure date helpers used by Sidebar's calendar UI. Extracted so the
// non-trivial month/grid/timestamp logic is unit-testable without mounting
// a Svelte component.

import { LOCALE } from "./locale";

export function monthStart(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function ymdLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export type CalendarCell = {
  day: number;
  ymd: string;
  hasMeeting: boolean;
  isToday: boolean;
};

// Builds a 6×7 (42-cell) Monday-first grid for the given month.
// `null` cells pad the lead-in days and trailing rows so the grid's height
// stays stable across months with different first-weekday offsets.
export function buildCalendarCells(
  viewMonth: Date,
  meetingDates: Set<string>,
  today: Date,
): (CalendarCell | null)[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  // Monday-first: JS getDay() is Sun=0..Sat=6; remap to Mon=0..Sun=6.
  const firstWeekday = (first.getDay() + 6) % 7;
  const todayYmd = ymdLocal(today);
  const cells: (CalendarCell | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) {
    const ymd = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({
      day: d,
      ymd,
      hasMeeting: meetingDates.has(ymd),
      isToday: ymd === todayYmd,
    });
  }
  while (cells.length < 42) cells.push(null);
  return cells;
}

export function fmtMonth(d: Date): string {
  return d.toLocaleString(LOCALE, { month: "long", year: "numeric" });
}

// For meetings started today show the time; for older meetings show the
// date. Keeps the sidebar's timestamp column narrow whatever the row's age.
// `now` is injectable so callers can pin behaviour in tests.
export function fmtTimestamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleString(LOCALE, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d
    .toLocaleString(LOCALE, {
      day: "numeric",
      month: "short",
    })
    .replace(",", "");
}
