import { describe, it, expect } from "vitest";
import { computeCommit } from "./commit";

const TS = "2026-04-23T12:00:00.000Z";

function makeIdFactory() {
  let n = 0;
  return () => `evt-${++n}`;
}

describe("computeCommit", () => {
  it("emits note_created for new non-empty paragraphs", () => {
    const out = computeCommit({
      previous: new Map(),
      current: [{ noteId: "p1", markdown: "hello" }],
      timestamp: TS,
      makeId: makeIdFactory(),
    });
    expect(out.events).toEqual([
      { type: "note_created", id: "evt-1", ts: TS, noteId: "p1", text: "hello" },
    ]);
    expect(out.nextState.get("p1")).toBe("hello");
  });

  it("skips whitespace-only new paragraphs", () => {
    const out = computeCommit({
      previous: new Map(),
      current: [{ noteId: "p1", markdown: "   " }],
      timestamp: TS,
      makeId: makeIdFactory(),
    });
    expect(out.events).toEqual([]);
    expect(out.nextState.has("p1")).toBe(false);
  });

  it("emits note_edited when content changes", () => {
    const out = computeCommit({
      previous: new Map([["p1", "hello"]]),
      current: [{ noteId: "p1", markdown: "**hello**" }],
      timestamp: TS,
      makeId: makeIdFactory(),
    });
    expect(out.events).toEqual([
      { type: "note_edited", id: "evt-1", ts: TS, noteId: "p1", text: "**hello**" },
    ]);
    expect(out.nextState.get("p1")).toBe("**hello**");
  });

  it("emits no event when content is identical", () => {
    const out = computeCommit({
      previous: new Map([["p1", "hello"]]),
      current: [{ noteId: "p1", markdown: "hello" }],
      timestamp: TS,
      makeId: makeIdFactory(),
    });
    expect(out.events).toEqual([]);
    expect(out.nextState.get("p1")).toBe("hello");
  });

  it("emits note_deleted when paragraph is removed", () => {
    const out = computeCommit({
      previous: new Map([["p1", "hello"]]),
      current: [],
      timestamp: TS,
      makeId: makeIdFactory(),
    });
    expect(out.events).toEqual([
      { type: "note_deleted", id: "evt-1", ts: TS, noteId: "p1" },
    ]);
    expect(out.nextState.has("p1")).toBe(false);
  });

  it("handles paragraph split: original edited, new created", () => {
    const out = computeCommit({
      previous: new Map([["p1", "hello world"]]),
      current: [
        { noteId: "p1", markdown: "hello" },
        { noteId: "p2", markdown: "world" },
      ],
      timestamp: TS,
      makeId: makeIdFactory(),
    });
    expect(out.events).toEqual([
      { type: "note_edited", id: "evt-1", ts: TS, noteId: "p1", text: "hello" },
      { type: "note_created", id: "evt-2", ts: TS, noteId: "p2", text: "world" },
    ]);
  });

  it("handles paragraph merge: absorbed deleted, absorber edited", () => {
    const out = computeCommit({
      previous: new Map([
        ["p1", "hello"],
        ["p2", "world"],
      ]),
      current: [{ noteId: "p1", markdown: "helloworld" }],
      timestamp: TS,
      makeId: makeIdFactory(),
    });
    expect(out.events).toEqual([
      { type: "note_edited", id: "evt-1", ts: TS, noteId: "p1", text: "helloworld" },
      { type: "note_deleted", id: "evt-2", ts: TS, noteId: "p2" },
    ]);
  });

  it("emits note_edited with empty text when committed paragraph is cleared", () => {
    const out = computeCommit({
      previous: new Map([["p1", "hello"]]),
      current: [{ noteId: "p1", markdown: "" }],
      timestamp: TS,
      makeId: makeIdFactory(),
    });
    expect(out.events).toEqual([
      { type: "note_edited", id: "evt-1", ts: TS, noteId: "p1", text: "" },
    ]);
  });

  it("handles mixed adds, edits, and deletes in one call", () => {
    const out = computeCommit({
      previous: new Map([
        ["a", "one"],
        ["b", "two"],
      ]),
      current: [
        { noteId: "a", markdown: "one" },
        { noteId: "c", markdown: "three" },
      ],
      timestamp: TS,
      makeId: makeIdFactory(),
    });
    expect(out.events).toEqual([
      { type: "note_created", id: "evt-1", ts: TS, noteId: "c", text: "three" },
      { type: "note_deleted", id: "evt-2", ts: TS, noteId: "b" },
    ]);
    expect(out.nextState.get("a")).toBe("one");
    expect(out.nextState.get("c")).toBe("three");
    expect(out.nextState.has("b")).toBe(false);
  });
});
