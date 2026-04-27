import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OatsFile } from "./types";

// In native mode, deleteSessionById walks the sidebar list, replaces the
// current session with a blank one, removes the deleted file from disk and
// re-saves the new blank. The test mocks the platform flag and the on-disk
// sessions module so we can exercise the full code path in node.

vi.mock("./platform", () => ({
  isNative: true,
  isWeb: false,
}));

const sessionFiles = new Map<string, OatsFile>();
vi.mock("./sessions", () => ({
  listSessions: vi.fn(async () =>
    Array.from(sessionFiles.values())
      .map((f) => ({
        sessionId: f.sessionId,
        title: f.title,
        createdAt: f.createdAt,
      }))
      // Match real sessions.ts ordering: newest first.
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  ),
  loadSession: vi.fn(async (id: string) => sessionFiles.get(id) ?? null),
  saveSession: vi.fn(async (file: OatsFile) => {
    sessionFiles.set(file.sessionId, structuredClone(file));
  }),
  deleteSession: vi.fn(async (id: string) => {
    sessionFiles.delete(id);
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
    sessionId: id,
    notetaker: "tester",
    title,
    createdAt,
    events: [
      { type: "session_started", id: `${id}-s`, ts: createdAt, notetaker: "tester" },
      { type: "note_created", id: `${id}-n`, ts: createdAt, noteId: "n1", text: "hi" },
    ],
    snapshot: { ops: [{ insert: "hi\n" }] },
    paragraphIds: ["n1"],
  };
}

describe("deleteSessionById (native)", () => {
  beforeEach(() => {
    sessionFiles.clear();
  });

  it("switches to the next-most-recent meeting when the current one is deleted", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    const b = makeFile("bbb", "Meeting B", "2026-04-27T11:00:00.000Z");
    sessionFiles.set(a.sessionId, a);
    sessionFiles.set(b.sessionId, b);

    const store = await loadStore();
    await store.initSession();
    // initSession picks the newest (B) as current. Sanity-check.
    expect(store.state.session?.sessionId).toBe("bbb");

    await store.deleteSessionById("bbb");

    // Deleted from disk and sidebar.
    expect(sessionFiles.has("bbb")).toBe(false);
    expect(store.state.sessions.find((m) => m.sessionId === "bbb")).toBeUndefined();
    // We moved to A, the next-most-recent meeting — not a fresh blank.
    expect(store.state.session?.sessionId).toBe("aaa");
    // No phantom blank meeting was created.
    expect(store.state.sessions.length).toBe(1);
    expect(sessionFiles.size).toBe(1);
  });

  it("creates a fresh blank meeting when the only meeting is deleted", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    sessionFiles.set(a.sessionId, a);

    const store = await loadStore();
    await store.initSession();
    expect(store.state.session?.sessionId).toBe("aaa");

    await store.deleteSessionById("aaa");

    // Old file gone, new blank created and persisted.
    expect(sessionFiles.has("aaa")).toBe(false);
    const currentId = store.state.session?.sessionId;
    expect(currentId).toBeDefined();
    expect(currentId).not.toBe("aaa");
    expect(sessionFiles.has(currentId!)).toBe(true);
    expect(store.state.sessions.some((m) => m.sessionId === currentId)).toBe(true);
  });

  it("deleting a non-current meeting leaves the current session untouched", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    const b = makeFile("bbb", "Meeting B", "2026-04-27T11:00:00.000Z");
    sessionFiles.set(a.sessionId, a);
    sessionFiles.set(b.sessionId, b);

    const store = await loadStore();
    await store.initSession();
    expect(store.state.session?.sessionId).toBe("bbb");

    await store.deleteSessionById("aaa");

    expect(store.state.session?.sessionId).toBe("bbb");
    expect(sessionFiles.has("aaa")).toBe(false);
    expect(sessionFiles.has("bbb")).toBe(true);
    expect(store.state.sessions.length).toBe(1);
  });

  it("clears live input markers when the current session is deleted", async () => {
    const a = makeFile("aaa", "Meeting A", "2026-04-27T10:00:00.000Z");
    sessionFiles.set(a.sessionId, a);

    const store = await loadStore();
    await store.initSession();
    store.noteInput();
    expect(store.state.firstInputAt).not.toBeNull();
    expect(store.state.lastInputAt).not.toBeNull();

    await store.deleteSessionById("aaa");

    expect(store.state.firstInputAt).toBeNull();
    expect(store.state.lastInputAt).toBeNull();
  });
});
