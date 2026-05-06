import { describe, it, expect } from "vitest";
import { labelFor, filterMeetings } from "./meetingFilter";
import type { MeetingSummary } from "./meetings";

const MEETINGS: MeetingSummary[] = [
  { meetingId: "a", title: "Standup", createdAt: "2026-04-25T09:00:00.000Z", started: true },
  { meetingId: "b", title: "  Roadmap  ", createdAt: "2026-04-26T15:30:00.000Z", started: true },
  { meetingId: "c", title: "", createdAt: "2026-04-27T10:00:00.000Z", started: true },
  { meetingId: "d", title: "Roadmap retro", createdAt: "2026-04-27T16:00:00.000Z", started: true },
];

describe("labelFor", () => {
  it("returns the trimmed title", () => {
    expect(labelFor("  Standup  ")).toBe("Standup");
  });

  it("falls back to 'meeting' for an empty or whitespace title", () => {
    expect(labelFor("")).toBe("meeting");
    expect(labelFor("   ")).toBe("meeting");
  });
});

describe("filterMeetings", () => {
  it("returns all meetings in text mode with empty/whitespace query", () => {
    expect(filterMeetings(MEETINGS, "text", "", null)).toEqual(MEETINGS);
    expect(filterMeetings(MEETINGS, "text", "   ", null)).toEqual(MEETINGS);
  });

  it("filters case-insensitively on the displayed label", () => {
    const out = filterMeetings(MEETINGS, "text", "ROADMAP", null);
    expect(out.map((m) => m.meetingId)).toEqual(["b", "d"]);
  });

  it("matches the 'meeting' fallback label for blank-titled meetings", () => {
    const out = filterMeetings(MEETINGS, "text", "meet", null);
    expect(out.map((m) => m.meetingId)).toContain("c");
  });

  it("returns all meetings in date mode with no selection", () => {
    expect(filterMeetings(MEETINGS, "date", "", null)).toEqual(MEETINGS);
  });

  it("filters by local YMD in date mode", () => {
    // Both 'c' and 'd' are 2026-04-27 in any timezone west of GMT-10.
    // Under UTC their createdAt's local YMD is 2026-04-27, so the test is
    // stable as long as the test runner's TZ sits between GMT-10 and GMT+13.
    const out = filterMeetings(MEETINGS, "date", "", "2026-04-27");
    expect(out.map((m) => m.meetingId).sort()).toEqual(["c", "d"]);
  });

  it("returns empty when no meeting matches the selected date", () => {
    const out = filterMeetings(MEETINGS, "date", "", "1999-01-01");
    expect(out).toEqual([]);
  });
});
