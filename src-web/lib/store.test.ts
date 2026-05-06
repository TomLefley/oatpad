import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OatsFile } from "./types";

// In native mode, deleteMeetingById walks the sidebar list, swaps in the
// next-most-recent meeting (or null when none remain), and removes the
// deleted file from disk. The test mocks the platform flag and the on-disk
// meetings module so we can exercise the full code path in node.

vi.mock("./platform", () => ({
  isNative: true,
  isWeb: false,
}));

const meetingFiles = new Map<string, OatsFile>();
vi.mock("./meetings", () => ({
  listMeetings: vi.fn(async () =>
    Array.from(meetingFiles.values())
      .map((f) => {
        const started = f.events.some(
          (e) => e.type === "note_updated" || e.type === "note_deleted",
        );
        return {
          meetingId: f.meetingId,
          title: f.title,
          createdAt: f.createdAt,
          ...(f.scheduledStartAt !== undefined
            ? { scheduledStartAt: f.scheduledStartAt }
            : {}),
          started,
        };
      })
      // Match real meetings.ts ordering: by scheduledStartAt ?? createdAt, newest first.
      .sort((a, b) => {
        const ka = a.scheduledStartAt ?? a.createdAt;
        const kb = b.scheduledStartAt ?? b.createdAt;
        return kb.localeCompare(ka);
      }),
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

  it("leaves state.meeting null when the only meeting is deleted", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting?.meetingId).toBe("aaa");

    await store.deleteMeetingById("aaa");

    // Old file gone, no phantom blank created — the Getting Started view
    // takes over once state.meeting is null.
    expect(meetingFiles.has("aaa")).toBe(false);
    expect(meetingFiles.size).toBe(0);
    expect(store.state.meeting).toBeNull();
    expect(store.state.meetings.length).toBe(0);
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

describe("initMeeting (native)", () => {
  beforeEach(() => {
    meetingFiles.clear();
  });

  it("leaves state.meeting null when no meetings exist on disk", async () => {
    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting).toBeNull();
    expect(store.state.meetings).toEqual([]);
    // No phantom blank persisted to disk.
    expect(meetingFiles.size).toBe(0);
  });
});

describe("switchMeeting (native)", () => {
  beforeEach(() => {
    meetingFiles.clear();
  });

  it("loads the requested meeting from disk and clears input markers", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    const b = makeFile("bbb", "Meeting B", "2026-04-27T11:00:00.000Z");
    meetingFiles.set(a.meetingId, a);
    meetingFiles.set(b.meetingId, b);

    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting?.meetingId).toBe("bbb");

    store.noteInput();
    expect(store.state.firstInputAt).not.toBeNull();

    await store.switchMeeting("aaa");

    expect(store.state.meeting?.meetingId).toBe("aaa");
    expect(store.state.firstInputAt).toBeNull();
    expect(store.state.lastInputAt).toBeNull();
  });

  it("is a no-op when switching to the meeting already in view", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting?.meetingId).toBe("aaa");

    // Mark some input then switch to the same meeting; markers must stay.
    store.noteInput();
    const before = store.state.firstInputAt;
    await store.switchMeeting("aaa");
    expect(store.state.firstInputAt).toBe(before);
  });

  it("flushes pending autosave to disk before switching", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    const b = makeFile("bbb", "Meeting B", "2026-04-27T11:00:00.000Z");
    meetingFiles.set(a.meetingId, a);
    meetingFiles.set(b.meetingId, b);

    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting?.meetingId).toBe("bbb");

    // Edit the title — a debounced autosave is now pending.
    store.setTitle("Meeting B (renamed)");
    expect(meetingFiles.get("bbb")?.title).toBe("Meeting B");

    // Switch should flush the pending save before loading A.
    await store.switchMeeting("aaa");
    expect(meetingFiles.get("bbb")?.title).toBe("Meeting B (renamed)");
  });

  it("ignores unknown meeting ids and leaves state intact", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    await store.switchMeeting("does-not-exist");
    expect(store.state.meeting?.meetingId).toBe("aaa");
  });
});

describe("setNotetaker (native)", () => {
  beforeEach(() => {
    meetingFiles.clear();
  });

  it("updates store + meeting and triggers a debounced disk write", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.notetaker).toBe("tester");

    store.setNotetaker("alice");
    expect(store.state.notetaker).toBe("alice");
    expect(store.state.meeting?.notetaker).toBe("alice");

    await store.flushPersist();
    expect(meetingFiles.get("aaa")?.notetaker).toBe("alice");
  });

  it("updates the standalone notetaker even when no meeting is open", async () => {
    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting).toBeNull();
    store.setNotetaker("bob");
    expect(store.state.notetaker).toBe("bob");
    // No meeting on disk to write — the standalone setter just records.
    expect(meetingFiles.size).toBe(0);
  });
});

describe("replaceMeetingFromFile (native)", () => {
  beforeEach(() => {
    meetingFiles.clear();
  });

  it("appends a file_loaded event and persists the meeting", async () => {
    const store = await loadStore();
    await store.initMeeting();
    const incoming = makeFile("ccc", "Imported", "2026-04-26T09:00:00.000Z");

    store.replaceMeetingFromFile(incoming);

    expect(store.state.meeting?.meetingId).toBe("ccc");
    const events = store.state.meeting?.events ?? [];
    expect(events.at(-1)?.type).toBe("file_loaded");

    await store.flushPersist();
    const onDisk = meetingFiles.get("ccc");
    expect(onDisk).toBeDefined();
    expect(onDisk?.events.at(-1)?.type).toBe("file_loaded");
  });

  it("preserves the existing notetaker rather than adopting the file's", async () => {
    const store = await loadStore();
    await store.initMeeting();
    store.setNotetaker("alice");
    const incoming = makeFile("ccc", "Imported", "2026-04-26T09:00:00.000Z");
    incoming.notetaker = "someone-else";

    store.replaceMeetingFromFile(incoming);

    expect(store.state.notetaker).toBe("alice");
    expect(store.state.meeting?.notetaker).toBe("alice");
  });

  it("adopts the file's notetaker when none is set locally", async () => {
    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.notetaker).toBe("");
    const incoming = makeFile("ccc", "Imported", "2026-04-26T09:00:00.000Z");
    incoming.notetaker = "carol";

    store.replaceMeetingFromFile(incoming);

    expect(store.state.notetaker).toBe("carol");
    expect(store.state.meeting?.notetaker).toBe("carol");
  });

  it("clears live input markers", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    store.noteInput();
    expect(store.state.firstInputAt).not.toBeNull();

    const incoming = makeFile("ccc", "Imported", "2026-04-26T09:00:00.000Z");
    store.replaceMeetingFromFile(incoming);

    expect(store.state.firstInputAt).toBeNull();
    expect(store.state.lastInputAt).toBeNull();
  });

  it("preserves scheduledStartAt from the loaded file", async () => {
    const store = await loadStore();
    await store.initMeeting();
    const incoming: OatsFile = {
      ...makeFile("ccc", "Imported", "2026-04-26T09:00:00.000Z"),
      scheduledStartAt: "2026-04-26T15:00:00.000Z",
    };
    store.replaceMeetingFromFile(incoming);
    expect(store.state.meeting?.scheduledStartAt).toBe(
      "2026-04-26T15:00:00.000Z",
    );
  });
});

describe("appendEvents (native) — sidebar started flag", () => {
  beforeEach(() => {
    meetingFiles.clear();
  });

  it("flips the current row's started flag to true once an edit event is appended", async () => {
    // Build a scheduled-but-not-started meeting: only the bookkeeping
    // meeting_started event in the log.
    const a: OatsFile = {
      version: 1,
      meetingId: "aaa",
      notetaker: "tester",
      title: "Planned",
      createdAt: "2026-04-29T08:00:00.000Z",
      scheduledStartAt: "2026-04-29T15:00:00.000Z",
      events: [
        {
          type: "meeting_started",
          id: "aaa-s",
          ts: "2026-04-29T08:00:00.000Z",
          notetaker: "tester",
        },
      ],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting?.meetingId).toBe("aaa");
    // Sidebar starts with started=false because the events log has no edits.
    expect(store.state.meetings[0].started).toBe(false);
    expect(store.state.meetings[0].scheduledStartAt).toBe(
      "2026-04-29T15:00:00.000Z",
    );

    // The user types — Editor commits a note_updated.
    store.appendEvents([
      {
        type: "note_updated",
        id: "u1",
        ts: "2026-04-29T15:01:00.000Z",
        noteId: "n1",
        text: "hi",
      },
    ]);

    // Sidebar must reflect the transition immediately so the clock icon
    // disappears the moment the meeting starts.
    expect(store.state.meetings[0].started).toBe(true);
  });
});

describe("setScheduledStartAt (native)", () => {
  beforeEach(() => {
    meetingFiles.clear();
  });

  it("writes scheduledStartAt onto the current meeting and refreshes the sidebar summary", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-29T08:00:00.000Z");
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting?.scheduledStartAt).toBeUndefined();
    expect(store.state.meetings[0].scheduledStartAt).toBeUndefined();

    store.setScheduledStartAt("2026-04-29T15:00:00.000Z");

    expect(store.state.meeting?.scheduledStartAt).toBe(
      "2026-04-29T15:00:00.000Z",
    );
    expect(store.state.meetings[0].scheduledStartAt).toBe(
      "2026-04-29T15:00:00.000Z",
    );

    await store.flushPersist();
    expect(meetingFiles.get("aaa")?.scheduledStartAt).toBe(
      "2026-04-29T15:00:00.000Z",
    );
  });

  it("is a no-op when there is no meeting in view", async () => {
    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting).toBeNull();
    // Must not throw — the empty-state Getting Started view never renders
    // a datetime picker, but a stale callback after delete shouldn't blow up.
    expect(() => store.setScheduledStartAt("2026-04-29T15:00:00.000Z")).not.toThrow();
  });
});

describe("clearScheduledStartAt (native)", () => {
  beforeEach(() => {
    meetingFiles.clear();
  });

  it("removes scheduledStartAt from the current meeting and the sidebar summary", async () => {
    const a: OatsFile = {
      ...makeFile("aaa", "Meeting A", "2026-04-29T08:00:00.000Z"),
      scheduledStartAt: "2026-04-29T15:00:00.000Z",
    };
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting?.scheduledStartAt).toBe(
      "2026-04-29T15:00:00.000Z",
    );
    expect(store.state.meetings[0].scheduledStartAt).toBe(
      "2026-04-29T15:00:00.000Z",
    );

    store.clearScheduledStartAt();

    expect(store.state.meeting?.scheduledStartAt).toBeUndefined();
    expect(store.state.meetings[0].scheduledStartAt).toBeUndefined();

    await store.flushPersist();
    expect(meetingFiles.get("aaa")?.scheduledStartAt).toBeUndefined();
  });

  it("is a no-op when there is no meeting in view", async () => {
    const store = await loadStore();
    await store.initMeeting();
    expect(() => store.clearScheduledStartAt()).not.toThrow();
  });
});

describe("flushPersist (native)", () => {
  beforeEach(() => {
    meetingFiles.clear();
  });

  it("writes the current meeting to disk synchronously, cancelling the debounce", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    meetingFiles.set(a.meetingId, a);

    const store = await loadStore();
    await store.initMeeting();
    store.setTitle("Renamed");
    // Title is in memory but the debounced write hasn't fired yet.
    expect(meetingFiles.get("aaa")?.title).toBe("Meeting A");

    await store.flushPersist();
    expect(meetingFiles.get("aaa")?.title).toBe("Renamed");
  });

  it("is a no-op when there is no meeting in view", async () => {
    const store = await loadStore();
    await store.initMeeting();
    expect(store.state.meeting).toBeNull();
    await store.flushPersist();
    expect(meetingFiles.size).toBe(0);
  });
});
