import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OatsFile } from "./types";

// Fresh mode keeps meetings in an in-memory map and bypasses disk entirely.
// We mock the freshMode flag to true and stub the Tauri fs APIs with sentinels
// — any stray call to disk would surface as a test failure via fsCalls.
vi.mock("./freshMode", () => ({ isFreshMode: true }));

const fsCalls = vi.fn();
vi.mock("@tauri-apps/api/path", () => ({
  BaseDirectory: { AppData: 1 },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (...args: unknown[]) => {
    fsCalls("exists", args);
    return Promise.resolve(false);
  },
  mkdir: (...args: unknown[]) => {
    fsCalls("mkdir", args);
    return Promise.resolve();
  },
  readDir: (...args: unknown[]) => {
    fsCalls("readDir", args);
    return Promise.resolve([]);
  },
  readTextFile: (...args: unknown[]) => {
    fsCalls("readTextFile", args);
    return Promise.resolve("");
  },
  remove: (...args: unknown[]) => {
    fsCalls("remove", args);
    return Promise.resolve();
  },
  writeTextFile: (...args: unknown[]) => {
    fsCalls("writeTextFile", args);
    return Promise.resolve();
  },
}));

async function loadMeetingsModule(): Promise<typeof import("./meetings")> {
  vi.resetModules();
  return await import("./meetings");
}

function makeFile(id: string, title: string, createdAt: string): OatsFile {
  return {
    version: 1,
    meetingId: id,
    notetaker: "tester",
    title,
    createdAt,
    events: [
      {
        type: "meeting_started",
        id: `${id}-s`,
        ts: createdAt,
        notetaker: "tester",
      },
    ],
    snapshot: { ops: [{ insert: "\n" }] },
    paragraphIds: [],
  };
}

describe("meetings (fresh mode)", () => {
  beforeEach(() => {
    fsCalls.mockClear();
  });

  it("saveMeeting then loadMeeting round-trips through the in-memory cache without touching disk", async () => {
    const m = await loadMeetingsModule();
    const file = makeFile("aaa", "First", "2026-04-27T10:00:00.000Z");

    await m.saveMeeting(file);
    const loaded = await m.loadMeeting("aaa");

    expect(loaded?.meetingId).toBe("aaa");
    expect(loaded?.title).toBe("First");
    expect(fsCalls).not.toHaveBeenCalled();
  });

  it("loadMeeting returns null for unknown ids", async () => {
    const m = await loadMeetingsModule();
    expect(await m.loadMeeting("nope")).toBeNull();
    expect(fsCalls).not.toHaveBeenCalled();
  });

  it("listMeetings returns cached summaries sorted newest first", async () => {
    const m = await loadMeetingsModule();
    await m.saveMeeting(makeFile("a", "Old", "2026-04-26T10:00:00.000Z"));
    await m.saveMeeting(makeFile("c", "New", "2026-04-28T10:00:00.000Z"));
    await m.saveMeeting(makeFile("b", "Mid", "2026-04-27T10:00:00.000Z"));

    const list = await m.listMeetings();

    expect(list.map((s) => s.meetingId)).toEqual(["c", "b", "a"]);
    expect(list[0]).toEqual({
      meetingId: "c",
      title: "New",
      createdAt: "2026-04-28T10:00:00.000Z",
    });
    expect(fsCalls).not.toHaveBeenCalled();
  });

  it("deleteMeeting removes a cached entry", async () => {
    const m = await loadMeetingsModule();
    await m.saveMeeting(makeFile("aaa", "First", "2026-04-27T10:00:00.000Z"));
    expect(await m.loadMeeting("aaa")).not.toBeNull();

    await m.deleteMeeting("aaa");

    expect(await m.loadMeeting("aaa")).toBeNull();
    expect(await m.listMeetings()).toEqual([]);
    expect(fsCalls).not.toHaveBeenCalled();
  });

  it("deleteMeeting on an unknown id is a no-op", async () => {
    const m = await loadMeetingsModule();
    await expect(m.deleteMeeting("missing")).resolves.toBeUndefined();
    expect(fsCalls).not.toHaveBeenCalled();
  });

  it("saving the same id overwrites the previous cached entry", async () => {
    const m = await loadMeetingsModule();
    await m.saveMeeting(makeFile("aaa", "Original", "2026-04-27T10:00:00.000Z"));
    await m.saveMeeting(makeFile("aaa", "Replaced", "2026-04-27T11:00:00.000Z"));

    const list = await m.listMeetings();
    expect(list.length).toBe(1);
    expect(list[0]?.title).toBe("Replaced");

    const loaded = await m.loadMeeting("aaa");
    expect(loaded?.title).toBe("Replaced");
    expect(loaded?.createdAt).toBe("2026-04-27T11:00:00.000Z");
  });

  it("cached entries are detached from the saved object — post-save mutations don't leak", async () => {
    const m = await loadMeetingsModule();
    const file = makeFile("aaa", "Original", "2026-04-27T10:00:00.000Z");
    await m.saveMeeting(file);

    // Mutate the original after saving — shared references would corrupt the cache.
    file.title = "Mutated";
    file.events.push({
      type: "meeting_started",
      id: "post",
      ts: "2026-04-27T11:00:00.000Z",
      notetaker: "tester",
    });

    const loaded = await m.loadMeeting("aaa");
    expect(loaded?.title).toBe("Original");
    expect(loaded?.events.length).toBe(1);
  });

  it("loaded entries are detached — caller mutations don't leak back into the cache", async () => {
    const m = await loadMeetingsModule();
    await m.saveMeeting(makeFile("aaa", "Original", "2026-04-27T10:00:00.000Z"));

    const first = await m.loadMeeting("aaa");
    if (!first) throw new Error("expected file to exist");
    first.title = "Mutated by caller";

    const second = await m.loadMeeting("aaa");
    expect(second?.title).toBe("Original");
  });

  it("module-level cache resets between fresh module loads", async () => {
    const m1 = await loadMeetingsModule();
    await m1.saveMeeting(makeFile("aaa", "Persisted", "2026-04-27T10:00:00.000Z"));
    expect((await m1.listMeetings()).length).toBe(1);

    // vi.resetModules() inside loadMeetingsModule blows away the cache —
    // mirrors what happens on a real app relaunch in fresh mode.
    const m2 = await loadMeetingsModule();
    expect(await m2.listMeetings()).toEqual([]);
  });
});
