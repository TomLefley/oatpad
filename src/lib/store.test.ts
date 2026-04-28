import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OatsFile } from "./types";

// In native mode, deleteMeetingById walks the sidebar list, replaces the
// current meeting with a blank one, removes the deleted file from disk and
// re-saves the new blank. The test mocks the platform flag and the on-disk
// meetings module so we can exercise the full code path in node.

vi.mock("./platform", () => ({
  isNative: true,
  isWeb: false,
}));

const meetingFiles = new Map<string, OatsFile>();
vi.mock("./meetings", () => ({
  listMeetings: vi.fn(async () =>
    Array.from(meetingFiles.values())
      .map((f) => ({
        meetingId: f.meetingId,
        title: f.title,
        createdAt: f.createdAt,
      }))
      // Match real meetings.ts ordering: newest first.
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  ),
  loadMeeting: vi.fn(async (id: string) => meetingFiles.get(id) ?? null),
  saveMeeting: vi.fn(async (file: OatsFile) => {
    meetingFiles.set(file.meetingId, structuredClone(file));
  }),
  deleteMeeting: vi.fn(async (id: string) => {
    meetingFiles.delete(id);
  }),
}));

// Re-import per test so module-level state starts fresh.
async function loadStore(): Promise<typeof import("./store.svelte")> {
  vi.resetModules();
  return await import("./store.svelte");
}

function makeFile(id: string, title: string, createdAt: string): OatsFile {
  return {
    version: 1,
    meetingId: id,
    notetaker: "tester",
    title,
    createdAt,
    events: [
      { type: "meeting_started", id: `${id}-s`, ts: createdAt, notetaker: "tester" },
      { type: "note_created", id: `${id}-c`, ts: createdAt, noteId: "n1" },
      {
        type: "note_updated",
        id: `${id}-u`,
        ts: createdAt,
        noteId: "n1",
        text: "hi",
      },
    ],
    snapshot: { ops: [{ insert: "hi\n" }] },
    paragraphIds: ["n1"],
  };
}

describe("deleteMeetingById (native)", () => {
  beforeEach(() => {
    meetingFiles.clear();
  });

  it("switches to the next-most-recent meeting when the current one is deleted", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    const b = makeFile("bbb", "Meeting B", "2026-04-27T11:00:00.000Z");
    meetingFiles.set(a.meetingId, a);
    meetingFiles.set(b.meetingId, b);

    const store = await loadStore();
    await store.initMeeting();
    // initMeeting picks the newest (B) as current. Sanity-check.
    expect(store.state.meeting?.meetingId).toBe("bbb");

    await store.deleteMeetingById("bbb");

    // Deleted from disk and sidebar.
    expect(meetingFiles.has("bbb")).toBe(false);
    expect(store.state.meetings.find((m) => m.meetingId === "bbb")).toBeUndefined();
    // We moved to A, the next-most-recent meeting — not a fresh blank.
    expect(store.state.meeting?.meetingId).toBe("aaa");
    // No phantom blank meeting was created.
    expect(store.state.meetings.length).toBe(1);
    expect(meetingFiles.size).toBe(1);
  });

  it("creates a fresh blank meeting when the only meeting is deleted", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting?.meetingId).toBe("aaa");

    await store.deleteMeetingById("aaa");

    // Old file gone, new blank created and persisted.
    expect(meetingFiles.has("aaa")).toBe(false);
    const currentId = store.state.meeting?.meetingId;
    expect(currentId).toBeDefined();
    expect(currentId).not.toBe("aaa");
    expect(meetingFiles.has(currentId!)).toBe(true);
    expect(store.state.meetings.some((m) => m.meetingId === currentId)).toBe(true);
  });

  it("deleting a non-current meeting leaves the current meeting untouched", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    const b = makeFile("bbb", "Meeting B", "2026-04-27T11:00:00.000Z");
    meetingFiles.set(a.meetingId, a);
    meetingFiles.set(b.meetingId, b);

    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting?.meetingId).toBe("bbb");

    await store.deleteMeetingById("aaa");

    expect(store.state.meeting?.meetingId).toBe("bbb");
    expect(meetingFiles.has("aaa")).toBe(false);
    expect(meetingFiles.has("bbb")).toBe(true);
    expect(store.state.meetings.length).toBe(1);
  });

  it("clears live input markers when the current meeting is deleted", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    store.noteInput();
    expect(store.state.firstInputAt).not.toBeNull();
    expect(store.state.lastInputAt).not.toBeNull();

    await store.deleteMeetingById("aaa");

    expect(store.state.firstInputAt).toBeNull();
    expect(store.state.lastInputAt).toBeNull();
  });
});
