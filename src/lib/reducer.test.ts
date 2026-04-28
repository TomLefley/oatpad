import { describe, it, expect } from "vitest";
import { replay } from "./reducer";
import type { OatsEvent } from "./types";

function ev(e: OatsEvent): OatsEvent {
  return e;
}

describe("replay", () => {
  it("starts empty", () => {
    const state = replay([]);
    expect(state.notetaker).toBe("");
    expect(state.notes.size).toBe(0);
  });

  it("captures meeting metadata", () => {
    const state = replay([
      ev({ type: "meeting_started", id: "e1", ts: "t0", notetaker: "Tom" }),
    ]);
    expect(state.notetaker).toBe("Tom");
  });

  it("accumulates edit history for a single note", () => {
    const state = replay([
      ev({ type: "note_created", id: "e1", ts: "t1", noteId: "n1", text: "hi" }),
      ev({ type: "note_edited", id: "e2", ts: "t2", noteId: "n1", text: "hi there" }),
      ev({ type: "note_edited", id: "e3", ts: "t3", noteId: "n1", text: "hello there" }),
    ]);
    const note = state.notes.get("n1")!;
    expect(note.currentText).toBe("hello there");
    expect(note.createdAt).toBe("t1");
    expect(note.lastEditedAt).toBe("t3");
    expect(note.history.map((h) => h.text)).toEqual([
      "hi",
      "hi there",
      "hello there",
    ]);
  });

  it("marks notes as deleted but preserves history", () => {
    const state = replay([
      ev({ type: "note_created", id: "e1", ts: "t1", noteId: "n1", text: "hi" }),
      ev({ type: "note_deleted", id: "e2", ts: "t2", noteId: "n1" }),
    ]);
    const note = state.notes.get("n1")!;
    expect(note.deleted).toBe(true);
    expect(note.currentText).toBe("hi");
    expect(note.history.length).toBe(1);
  });

  it("ignores file_loaded for note state but preserves order for subsequent events", () => {
    const state = replay([
      ev({ type: "note_created", id: "e1", ts: "t1", noteId: "n1", text: "a" }),
      ev({ type: "file_loaded", id: "e2", ts: "t2", sourceTitle: "old" }),
      ev({ type: "note_edited", id: "e3", ts: "t3", noteId: "n1", text: "b" }),
    ]);
    const note = state.notes.get("n1")!;
    expect(note.currentText).toBe("b");
    expect(note.history.length).toBe(2);
  });

  it("ignores edits to unknown notes", () => {
    const state = replay([
      ev({ type: "note_edited", id: "e1", ts: "t1", noteId: "ghost", text: "x" }),
    ]);
    expect(state.notes.size).toBe(0);
  });
});
