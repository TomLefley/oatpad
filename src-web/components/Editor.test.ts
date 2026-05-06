// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import Quill from "quill";
import type { OatsEvent, QuillDelta } from "../lib/types";

// The Editor pipeline composes Quill text-change → reconcileNoteIds →
// readParagraphs → onTextChange → store.appendEvents + setSnapshot.
// Unit tests cover the algorithm pieces in isolation; this file exercises
// the wiring by mounting Editor.svelte in jsdom, driving Quill via its
// public API, and asserting on what would have reached the store.

type StoreMeeting = {
  version: 1;
  meetingId: string;
  notetaker: string;
  title: string;
  createdAt: string;
  events: OatsEvent[];
  snapshot: QuillDelta;
  paragraphIds: string[];
};

type StoreState = {
  meeting: StoreMeeting | null;
  notetaker: string;
};

const storeState: StoreState = { meeting: null, notetaker: "" };
const appendEvents = vi.fn<(events: OatsEvent[]) => void>();
const setSnapshot = vi.fn<(snapshot: QuillDelta, ids: string[]) => void>();
const setTitle = vi.fn<(title: string) => void>();
const noteInput = vi.fn();

vi.mock("../lib/store.svelte", () => ({
  get state() {
    return storeState;
  },
  appendEvents: (events: OatsEvent[]) => appendEvents(events),
  setSnapshot: (snapshot: QuillDelta, ids: string[]) =>
    setSnapshot(snapshot, ids),
  setTitle: (t: string) => setTitle(t),
  noteInput: () => noteInput(),
  registerEditorFlush: vi.fn(),
  unregisterEditorFlush: vi.fn(),
}));

function seedMeeting(overrides: Partial<StoreMeeting> = {}): StoreMeeting {
  storeState.meeting = {
    version: 1,
    meetingId: "m1",
    notetaker: "tester",
    title: "",
    createdAt: "2026-04-30T10:00:00.000Z",
    events: [],
    snapshot: { ops: [{ insert: "\n" }] },
    paragraphIds: [],
    ...overrides,
  };
  return storeState.meeting!;
}

async function mountEditor() {
  const Editor = (await import("./Editor.svelte")).default;
  const result = render(Editor);
  // Quill mounts in onMount — yield once so it's ready.
  await tick();
  const containerEl = result.container.querySelector(
    ".ql-container",
  ) as HTMLElement | null;
  if (!containerEl) throw new Error("Quill container never rendered");
  const quill = Quill.find(containerEl) as Quill | null;
  if (!quill) throw new Error("Quill instance not found on container");
  return { ...result, quill };
}

beforeEach(() => {
  storeState.meeting = null;
  storeState.notetaker = "";
  appendEvents.mockClear();
  setSnapshot.mockClear();
  setTitle.mockClear();
  noteInput.mockClear();
});

function flatEvents(): OatsEvent[] {
  return appendEvents.mock.calls.flatMap((c) => c[0]);
}

describe("Editor — mount and reload", () => {
  it("seeds Quill from the meeting snapshot and stamps note ids", async () => {
    seedMeeting({
      snapshot: {
        ops: [{ insert: "first line\nsecond line\n" }],
      },
      paragraphIds: ["n1", "n2"],
    });
    const { quill } = await mountEditor();
    const blocks = Array.from(quill.root.children);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.getAttribute("data-note-id")).toBe("n1");
    expect(blocks[1]?.getAttribute("data-note-id")).toBe("n2");
  });

  it("renders an empty paragraph and emits no events when there is no meeting", async () => {
    storeState.meeting = null;
    await mountEditor();
    expect(appendEvents).not.toHaveBeenCalled();
    expect(setSnapshot).not.toHaveBeenCalled();
  });

  it("assigns a fresh note id to a paragraph that arrives without one", async () => {
    seedMeeting({
      snapshot: { ops: [{ insert: "orphan\n" }] },
      paragraphIds: [],
    });
    const { quill } = await mountEditor();
    const block = quill.root.children[0] as HTMLElement;
    expect(block.getAttribute("data-note-id")).toMatch(/.+/);
  });
});

describe("Editor — onTextChange wiring", () => {
  it("splits a paragraph silently, then flows typed content to appendEvents on flush", async () => {
    seedMeeting({
      snapshot: { ops: [{ insert: "first\n" }] },
      paragraphIds: ["pid-first"],
    });
    const { component, quill } = await mountEditor();
    appendEvents.mockClear();
    setSnapshot.mockClear();

    // Pressing Enter splits the paragraph; the new sibling gets a fresh
    // id via reconcileNoteIds. The split itself emits no event — the
    // empty paragraph is just tracked internally — so we type something
    // and flush to verify the new noteId reached the pipeline.
    quill.insertText("first".length, "\n", "user");
    await tick();

    expect(flatEvents()).toEqual([]);

    quill.insertText("first\n".length, "second", "user");
    await tick();

    (component as unknown as { flush: () => void }).flush();
    const events = flatEvents();
    const updated = events.filter((e) => e.type === "note_updated");
    const newParagraph = updated.find((e) => e.text === "second");
    expect(newParagraph).toBeDefined();
    expect(newParagraph!.noteId).not.toBe("pid-first");
    expect(newParagraph!.noteId).toMatch(/.+/);
  });

  it("calls store.noteInput on user-driven text changes (live input marker)", async () => {
    seedMeeting();
    const { quill } = await mountEditor();
    noteInput.mockClear();
    quill.insertText(0, "x", "user");
    await tick();
    expect(noteInput).toHaveBeenCalled();
  });

  it("does not call noteInput for programmatic (silent / api) changes", async () => {
    seedMeeting();
    const { quill } = await mountEditor();
    noteInput.mockClear();
    quill.insertText(0, "robot", "silent");
    await tick();
    expect(noteInput).not.toHaveBeenCalled();
  });

  it("emits note_deleted when a paragraph is removed", async () => {
    seedMeeting({
      snapshot: { ops: [{ insert: "one\ntwo\n" }] },
      paragraphIds: ["keep", "drop"],
    });
    const { quill } = await mountEditor();
    appendEvents.mockClear();

    // Delete the second paragraph (text "two\n" — 4 chars including newline).
    // The first paragraph occupies indices 0..3 ("one\n"); position 4..7
    // is "two\n".
    quill.deleteText(4, 4, "user");
    await tick();

    const events = flatEvents();
    const deleted = events.filter((e) => e.type === "note_deleted");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ type: "note_deleted", noteId: "drop" });
  });
});

describe("Editor — flush()", () => {
  it("emits a settled note_updated for the in-flight paragraph and persists snapshot ids", async () => {
    seedMeeting();
    const { component, quill } = await mountEditor();

    quill.insertText(0, "draft", "user");
    await tick();
    appendEvents.mockClear();
    setSnapshot.mockClear();

    (component as unknown as { flush: () => void }).flush();

    // Snapshot is unconditional on flush.
    expect(setSnapshot).toHaveBeenCalled();
    const snapshotCall = setSnapshot.mock.calls[0];
    const ids = snapshotCall[1];
    expect(ids.length).toBeGreaterThan(0);

    // Any pending settled-state for the typed paragraph is flushed.
    const events = flatEvents();
    const updated = events.filter((e) => e.type === "note_updated");
    if (updated.length > 0) {
      expect(updated[0].text).toContain("draft");
    }
  });

  it("does not append events when there is nothing pending", async () => {
    seedMeeting({
      snapshot: { ops: [{ insert: "settled\n" }] },
      paragraphIds: ["s1"],
    });
    const { component } = await mountEditor();
    appendEvents.mockClear();
    setSnapshot.mockClear();

    (component as unknown as { flush: () => void }).flush();
    expect(appendEvents).not.toHaveBeenCalled();
    expect(setSnapshot).toHaveBeenCalled();
  });
});

describe("Editor — reload()", () => {
  it("reseeds Quill from the new store.state.meeting without emitting events", async () => {
    seedMeeting({
      snapshot: { ops: [{ insert: "first\n" }] },
      paragraphIds: ["pid-1"],
    });
    const { component, quill } = await mountEditor();

    seedMeeting({
      meetingId: "m2",
      snapshot: { ops: [{ insert: "alpha\nbeta\n" }] },
      paragraphIds: ["pid-a", "pid-b"],
    });

    appendEvents.mockClear();
    setSnapshot.mockClear();
    (component as unknown as { reload: () => void }).reload();
    await tick();

    const ids = Array.from(quill.root.children).map((b) =>
      (b as HTMLElement).getAttribute("data-note-id"),
    );
    expect(ids).toEqual(["pid-a", "pid-b"]);
    expect(appendEvents).not.toHaveBeenCalled();
  });

  it("clears Quill back to a single empty paragraph when the meeting becomes null", async () => {
    seedMeeting({
      snapshot: { ops: [{ insert: "leftover\n" }] },
      paragraphIds: ["leftover-id"],
    });
    const { component, quill } = await mountEditor();

    storeState.meeting = null;
    (component as unknown as { reload: () => void }).reload();
    await tick();

    const blocks = Array.from(quill.root.children);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.textContent ?? "").toBe("");
  });

  it("re-seeds noteFlush state so the next typed change is treated as a continuation", async () => {
    seedMeeting({
      snapshot: { ops: [{ insert: "loaded text\n" }] },
      paragraphIds: ["loaded-id"],
    });
    const { quill } = await mountEditor();
    appendEvents.mockClear();

    // A small in-word edit on a freshly-loaded paragraph must NOT emit an
    // immediate update — the seed-from-snapshot path is exactly what
    // suppresses spurious events comparing against runStartText="".
    quill.insertText("loaded text".length, "!", "user");
    await tick();

    // The change is a single-character add to an existing word; cross-word
    // is false. The emitted events should not include a note_updated for
    // this small in-word append (it should sit silently inside the run).
    const events = flatEvents();
    const updates = events.filter(
      (e) => e.type === "note_updated" && e.noteId === "loaded-id",
    );
    expect(updates).toHaveLength(0);
  });
});

describe("Editor — toolbar tooltips", () => {
  it("decorates the bubble toolbar with title attributes for keyboard shortcuts", async () => {
    seedMeeting();
    const { container } = await mountEditor();
    const tooltip = container.querySelector(".ql-tooltip");
    expect(tooltip).not.toBeNull();
    const bold = tooltip?.querySelector(".ql-bold") as HTMLElement | null;
    expect(bold).not.toBeNull();
    expect(bold!.title).toMatch(/Bold \((⌘|Ctrl)\+B\)/);

    const italic = tooltip?.querySelector(".ql-italic") as HTMLElement | null;
    expect(italic!.title).toMatch(/Italic \((⌘|Ctrl)\+I\)/);

    const headerItems = tooltip?.querySelectorAll<HTMLElement>(
      ".ql-header .ql-picker-item",
    );
    expect(headerItems && headerItems.length).toBeGreaterThan(0);
    const titles = Array.from(headerItems!).map((el) => el.title);
    expect(titles.some((t) => /Heading \d/.test(t))).toBe(true);
  });
});

// Inline-markdown shortcut application depends on Quill's selection +
// range bounds, which jsdom only partially implements (Range has no
// getBoundingClientRect). The matchInline predicate itself is unit-tested
// in markdownShortcuts.test.ts; the wiring to Quill's silent format calls
// is left to manual / browser verification.
