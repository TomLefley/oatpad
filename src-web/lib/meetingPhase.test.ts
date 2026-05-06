import { describe, it, expect } from "vitest";
import { editBounds, phaseFor } from "./meetingPhase";
import type { OatsEvent } from "./types";

function ev(e: OatsEvent): OatsEvent {
  return e;
}

describe("editBounds", () => {
  it("returns nulls when there are no edits and no live markers", () => {
    expect(editBounds([], null, null)).toEqual({ first: null, last: null });
  });

  it("ignores meeting_started and file_loaded", () => {
    const out = editBounds(
      [
        ev({ type: "meeting_started", id: "s", ts: "t1", notetaker: "Tom" }),
        ev({ type: "file_loaded", id: "f", ts: "t9", sourceTitle: "old" }),
      ],
      null,
      null,
    );
    expect(out).toEqual({ first: null, last: null });
  });

  it("returns first and last edit timestamp from committed events", () => {
    const out = editBounds(
      [
        ev({ type: "note_updated", id: "1", ts: "2026-04-27T10:00:00Z", noteId: "n1", text: "ab" }),
        ev({ type: "note_updated", id: "2", ts: "2026-04-27T10:00:05Z", noteId: "n1", text: "abcd" }),
        ev({ type: "note_deleted", id: "3", ts: "2026-04-27T10:00:10Z", noteId: "n1" }),
      ],
      null,
      null,
    );
    expect(out.first).toBe("2026-04-27T10:00:00Z");
    expect(out.last).toBe("2026-04-27T10:00:10Z");
  });

  it("blends in live input markers — earlier first, later last", () => {
    const out = editBounds(
      [
        ev({ type: "note_updated", id: "1", ts: "2026-04-27T10:00:05Z", noteId: "n1", text: "x" }),
      ],
      "2026-04-27T10:00:00Z",
      "2026-04-27T10:00:10Z",
    );
    expect(out.first).toBe("2026-04-27T10:00:00Z");
    expect(out.last).toBe("2026-04-27T10:00:10Z");
  });

  it("does not regress bounds when live markers are inside the committed window", () => {
    const out = editBounds(
      [
        ev({ type: "note_updated", id: "1", ts: "2026-04-27T10:00:00Z", noteId: "n1", text: "a" }),
        ev({ type: "note_updated", id: "2", ts: "2026-04-27T10:00:30Z", noteId: "n1", text: "abc" }),
      ],
      "2026-04-27T10:00:10Z",
      "2026-04-27T10:00:20Z",
    );
    expect(out.first).toBe("2026-04-27T10:00:00Z");
    expect(out.last).toBe("2026-04-27T10:00:30Z");
  });

  it("uses live markers alone when there are no committed edit events", () => {
    const out = editBounds(
      [ev({ type: "meeting_started", id: "s", ts: "2026-04-27T09:00:00Z", notetaker: "Tom" })],
      "2026-04-27T10:00:00Z",
      "2026-04-27T10:00:30Z",
    );
    expect(out.first).toBe("2026-04-27T10:00:00Z");
    expect(out.last).toBe("2026-04-27T10:00:30Z");
  });
});

describe("phaseFor", () => {
  it("is 'none' when there is no last edit, regardless of elapsed", () => {
    expect(phaseFor(0, false)).toBe("none");
    expect(phaseFor(10_000_000, false)).toBe("none");
  });

  it("is 'live' under one minute since the last edit", () => {
    expect(phaseFor(0, true)).toBe("live");
    expect(phaseFor(59_999, true)).toBe("live");
  });

  it("is 'idle' between one and three minutes", () => {
    expect(phaseFor(60_000, true)).toBe("idle");
    expect(phaseFor(179_999, true)).toBe("idle");
  });

  it("is 'ended' at three minutes and beyond", () => {
    expect(phaseFor(180_000, true)).toBe("ended");
    expect(phaseFor(60 * 60_000, true)).toBe("ended");
  });

  it("clamps a negative elapsed (clock skew) to 'live'", () => {
    expect(phaseFor(-5_000, true)).toBe("live");
  });
});
