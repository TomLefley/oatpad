// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import Quill from "quill";
import type { OatsEvent, QuillDelta } from "../lib/types";

// Pipeline tests for the per-note idle buffer in Editor.svelte. The
// buffer routes `note_updated` events from `onTextChange` through a
// 1.5s per-note timer that resets on continued activity, so rapid edit-
// rewrite bursts coalesce into a single settled-state event. See the
// IDLE_EMIT_MS comment in Editor.svelte for design context.

const IDLE_MS = 1500;

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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function flatEvents(): OatsEvent[] {
  return appendEvents.mock.calls.flatMap((c) => c[0]);
}

function noteUpdates(): { noteId: string; text: string }[] {
  return flatEvents()
    .filter((e): e is OatsEvent & { type: "note_updated" } =>
      e.type === "note_updated",
    )
    .map((e) => ({ noteId: e.noteId, text: e.text }));
}

// Type a string char-by-char so onTextChange runs once per insertion.
// The buffer's "within-word activity resets the timer" rule needs many
// individual text-change events, not one big insert, to be exercised.
function type(quill: Quill, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    quill.insertText(at + i, text[i], "user");
  }
}

describe("Editor — idle buffer", () => {
  it("a cross-word reversal does not emit note_updated synchronously", async () => {
    seedMeeting();
    const { quill } = await mountEditor();
    appendEvents.mockClear();

    // Pure add: "hello world" — no cross-word reversal yet.
    type(quill, 0, "hello world");
    await tick();
    expect(noteUpdates()).toEqual([]);

    // First backspace ends the add run with a cross-word reversal
    // (isCrossWord("", "hello world") → true). This used to emit
    // synchronously; with the buffer it arms a timer instead.
    quill.deleteText(quill.getLength() - 2, 1, "user"); // drop 'd' before trailing \n
    await tick();
    expect(noteUpdates()).toEqual([]);
  });

  it("the buffered emit lands after IDLE_EMIT_MS of inactivity", async () => {
    seedMeeting();
    const { quill } = await mountEditor();

    type(quill, 0, "hello world");
    quill.deleteText(quill.getLength() - 2, 1, "user");
    await tick();
    appendEvents.mockClear();

    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(noteUpdates()).toEqual([]);

    vi.advanceTimersByTime(2);
    const updates = noteUpdates();
    expect(updates).toHaveLength(1);
    // Timer fires flushNote → emits current lastText, which is the
    // post-deletion state, not the pre-reversal "hello world".
    expect(updates[0].text).toBe("hello worl");
  });

  it("within-word activity in an armed note resets the timer", async () => {
    seedMeeting();
    const { quill } = await mountEditor();

    type(quill, 0, "hello world");
    // Cross-word reversal arms the timer.
    quill.deleteText(quill.getLength() - 2, 1, "user");
    await tick();
    appendEvents.mockClear();

    // Wait almost the whole idle window, then type one more char.
    vi.advanceTimersByTime(IDLE_MS - 100);
    expect(noteUpdates()).toEqual([]);

    quill.insertText(quill.getLength() - 1, "x", "user");
    await tick();

    // From the original arm, the timer would fire 100ms from now. But
    // the within-word edit just reset it — so 200ms (well past 100)
    // should still be silent.
    vi.advanceTimersByTime(200);
    expect(noteUpdates()).toEqual([]);

    // Now wait the full window from the reset.
    vi.advanceTimersByTime(IDLE_MS);
    const updates = noteUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].text).toBe("hello worlx");
  });

  it("rapid edit-rewrite bursts coalesce into a single emit", async () => {
    seedMeeting();
    const { quill } = await mountEditor();

    // Five cross-word reversals in quick succession. Each individual
    // reversal would have produced an event before the buffer; with
    // the buffer they all collapse to one emit at the end.
    type(quill, 0, "hello world");
    for (let i = 0; i < 5; i++) {
      // Delete back to "hello " (drops "world" → cross-word reversal).
      quill.deleteText(6, 5, "user");
      await tick();
      vi.advanceTimersByTime(50);
      // Retype "world" (cross-word reversal again on first add char).
      type(quill, 6, "world");
      await tick();
      vi.advanceTimersByTime(50);
    }
    appendEvents.mockClear();

    // Drain idle window — only one event lands.
    vi.advanceTimersByTime(IDLE_MS + 10);
    const updates = noteUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].text).toBe("hello world");
  });

  it("pure-typing without cross-word reversal does not arm the timer (no fragmentation on long pause)", async () => {
    seedMeeting();
    const { quill } = await mountEditor();

    // Long pure-add run with no reversals.
    type(quill, 0, "hello world there");
    await tick();
    appendEvents.mockClear();

    // Long pause — far past the idle window. With pure idle-debounce
    // this would fire and fragment the thought; the buffer must NOT
    // arm because no cross-word boundary fired.
    vi.advanceTimersByTime(IDLE_MS * 5);
    expect(noteUpdates()).toEqual([]);
  });

  it("focus-loss before the timer fires emits current text immediately and cancels the timer", async () => {
    seedMeeting();
    const { component, quill } = await mountEditor();

    type(quill, 0, "hello world");
    quill.deleteText(quill.getLength() - 2, 1, "user");
    await tick();
    appendEvents.mockClear();

    // Mid-idle: blur should flush synchronously.
    vi.advanceTimersByTime(500);
    (component as unknown as { flush: () => void }).flush();

    const updates = noteUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].text).toBe("hello worl");

    // Advancing further must not produce another (timer was cancelled).
    appendEvents.mockClear();
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(noteUpdates()).toEqual([]);
  });

  it("note_deleted cancels the buffered emit for that note", async () => {
    seedMeeting({
      snapshot: { ops: [{ insert: "first\nsecond\n" }] },
      paragraphIds: ["keep", "drop"],
    });
    const { quill } = await mountEditor();

    // Trigger a cross-word reversal on the second paragraph: type
    // " more", then delete it. "second" → "second more" (pure add) →
    // delete " more" → cross-word reversal arms the timer for "drop".
    type(quill, "first\nsecond".length, " more");
    quill.deleteText("first\nsecond".length, 5, "user");
    await tick();
    appendEvents.mockClear();

    // Now delete the entire second paragraph (text + newline).
    quill.deleteText("first\n".length, "second\n".length, "user");
    await tick();

    // note_deleted should land synchronously; the idle timer is gone,
    // so advancing time produces no further events for "drop".
    const events = flatEvents();
    expect(events.some((e) => e.type === "note_deleted" && e.noteId === "drop")).toBe(true);

    appendEvents.mockClear();
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(
      flatEvents().some(
        (e) => e.type === "note_updated" && e.noteId === "drop",
      ),
    ).toBe(false);
  });
});
