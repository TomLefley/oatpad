import { describe, it, expect } from "vitest";
import {
  monthStart,
  ymdLocal,
  buildCalendarCells,
  fmtTimestamp,
  type CalendarCell,
} from "./calendar";

describe("monthStart", () => {
  it("rewinds to the 1st at midnight local", () => {
    const start = monthStart(new Date(2026, 3, 27, 14, 30, 0));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it("does not mutate the input", () => {
    const original = new Date(2026, 3, 27, 14, 30);
    const copy = new Date(original);
    monthStart(original);
    expect(original.getTime()).toBe(copy.getTime());
  });
});

describe("ymdLocal", () => {
  it("zero-pads month and day", () => {
    expect(ymdLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(ymdLocal(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("buildCalendarCells", () => {
  // April 2026: 1st is a Wednesday (Mon-first index 2). 30 days.
  const april = new Date(2026, 3, 1);
  const today = new Date(2026, 3, 27);

  it("always returns 42 cells (6×7)", () => {
    const cells = buildCalendarCells(april, new Set(), today);
    expect(cells).toHaveLength(42);
  });

  it("pads leading days with null until the 1st falls on its weekday column", () => {
    const cells = buildCalendarCells(april, new Set(), today);
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBeNull();
    expect((cells[2] as CalendarCell).day).toBe(1);
    expect((cells[2] as CalendarCell).ymd).toBe("2026-04-01");
  });

  it("places the last day of the month and pads the rest with null", () => {
    const cells = buildCalendarCells(april, new Set(), today);
    // April has 30 days; with 2 leading nulls the 30th lands at index 31.
    expect((cells[31] as CalendarCell).day).toBe(30);
    expect(cells[32]).toBeNull();
    expect(cells[41]).toBeNull();
  });

  it("flags days that have meetings", () => {
    const dates = new Set(["2026-04-15", "2026-04-27"]);
    const cells = buildCalendarCells(april, dates, today);
    const real = cells.filter((c): c is CalendarCell => c !== null);
    const flagged = real.filter((c) => c.hasMeeting).map((c) => c.ymd);
    expect(flagged).toEqual(["2026-04-15", "2026-04-27"]);
  });

  it("flags exactly one cell as today", () => {
    const cells = buildCalendarCells(april, new Set(), today);
    const real = cells.filter((c): c is CalendarCell => c !== null);
    expect(real.filter((c) => c.isToday).map((c) => c.ymd)).toEqual([
      "2026-04-27",
    ]);
  });

  it("flags no cell as today when today falls outside the view", () => {
    const cells = buildCalendarCells(april, new Set(), new Date(2026, 4, 1));
    const real = cells.filter((c): c is CalendarCell => c !== null);
    expect(real.some((c) => c.isToday)).toBe(false);
  });

  it("handles a Monday-first month with no leading pad", () => {
    // June 2026: 1st is a Monday.
    const cells = buildCalendarCells(new Date(2026, 5, 1), new Set(), today);
    expect((cells[0] as CalendarCell).day).toBe(1);
    expect((cells[0] as CalendarCell).ymd).toBe("2026-06-01");
  });

  it("handles a Sunday-first month with six leading pads", () => {
    // March 2026: 1st is a Sunday → 6 leading null cells.
    const cells = buildCalendarCells(new Date(2026, 2, 1), new Set(), today);
    for (let i = 0; i < 6; i++) expect(cells[i]).toBeNull();
    expect((cells[6] as CalendarCell).day).toBe(1);
  });

  it("flags a single-day selection on isRangeStart only", () => {
    const cells = buildCalendarCells(april, new Set(), today, "2026-04-15");
    const real = cells.filter((c): c is CalendarCell => c !== null);
    const start = real.filter((c) => c.isRangeStart).map((c) => c.ymd);
    expect(start).toEqual(["2026-04-15"]);
    expect(real.some((c) => c.isRangeEnd)).toBe(false);
    expect(real.some((c) => c.inRange)).toBe(false);
  });

  it("flags both endpoints and the strictly-interior days of a range", () => {
    const cells = buildCalendarCells(
      april,
      new Set(),
      today,
      "2026-04-10",
      "2026-04-13",
    );
    const real = cells.filter((c): c is CalendarCell => c !== null);
    expect(real.filter((c) => c.isRangeStart).map((c) => c.ymd)).toEqual([
      "2026-04-10",
    ]);
    expect(real.filter((c) => c.isRangeEnd).map((c) => c.ymd)).toEqual([
      "2026-04-13",
    ]);
    expect(real.filter((c) => c.inRange).map((c) => c.ymd)).toEqual([
      "2026-04-11",
      "2026-04-12",
    ]);
  });

  it("leaves all range fields false when no selection is given", () => {
    const cells = buildCalendarCells(april, new Set(), today);
    const real = cells.filter((c): c is CalendarCell => c !== null);
    expect(real.every((c) => !c.isRangeStart && !c.isRangeEnd && !c.inRange)).toBe(true);
  });
});

describe("fmtTimestamp", () => {
  // Pin to a stable reference; locale strings include "BST" / "GMT" only when
  // a timezone option is requested, so en-GB output is portable.
  const todayBase = new Date(2026, 3, 27, 9, 0);

  it("returns time-only when the iso timestamp is on the same local day", () => {
    const out = fmtTimestamp("2026-04-27T14:05:00", todayBase);
    expect(out).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns short date when the iso timestamp is on a different day", () => {
    const out = fmtTimestamp("2026-04-26T14:05:00", todayBase);
    expect(out).not.toMatch(/^\d{2}:\d{2}$/);
    expect(out).toMatch(/Apr/);
  });
});
