import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OatsFile } from "./types";

// Mirror of store.test.ts but for the *web* code path: localStorage-backed,
// no Tauri fs. Lives in its own file because vi.mock is hoisted per-module
// and we need a different platform fixture than the native test.

vi.mock("./platform", () => ({
  isNative: false,
  isWeb: true,
}));

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
  get length(): number {
    return this.data.size;
  }
  key(i: number): string | null {
    return Array.from(this.data.keys())[i] ?? null;
  }
}

let store_localStorage: FakeLocalStorage;

beforeEach(() => {
  store_localStorage = new FakeLocalStorage();
  // The store reads localStorage at import time, so install the global
  // *before* the dynamic import in loadStore().
  Object.defineProperty(globalThis, "localStorage", {
    value: store_localStorage,
    configurable: true,
    writable: true,
  });
});

async function loadStore(): Promise<typeof import("./store.svelte")> {
  vi.resetModules();
  return await import("./store.svelte");
}

describe("initSession (web)", () => {
  it("creates a fresh blank session and persists it when nothing is in localStorage", async () => {
    const store = await loadStore();
    await store.initSession();
    expect(store.state.session).not.toBeNull();
    expect(store.state.session?.events[0]?.type).toBe("session_started");
    // The blank session was persisted to localStorage under oatpad.session.
    const raw = store_localStorage.getItem("oatpad.session");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.sessionId).toBe(store.state.session?.sessionId);
  });

  it("restores an existing session from localStorage and pulls its notetaker forward", async () => {
    const stored = {
      version: 1,
      sessionId: "saved-1",
      notetaker: "Restored",
      title: "Old meeting",
      createdAt: "2026-04-27T10:00:00.000Z",
      events: [
        {
          type: "session_started",
          id: "e1",
          ts: "2026-04-27T10:00:00.000Z",
          notetaker: "Restored",
        },
      ],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    store_localStorage.setItem("oatpad.session", JSON.stringify(stored));

    const store = await loadStore();
    await store.initSession();
    expect(store.state.session?.sessionId).toBe("saved-1");
    expect(store.state.notetaker).toBe("Restored");
  });

  it("ignores a session payload with an unsupported version", async () => {
    const stored = {
      version: 999,
      sessionId: "future",
      notetaker: "x",
      title: "",
      createdAt: "2026-04-27T10:00:00.000Z",
      events: [],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    store_localStorage.setItem("oatpad.session", JSON.stringify(stored));

    const store = await loadStore();
    await store.initSession();
    expect(store.state.session?.sessionId).not.toBe("future");
  });

  it("ignores malformed JSON in localStorage and starts fresh", async () => {
    store_localStorage.setItem("oatpad.session", "{not valid json");
    const store = await loadStore();
    await store.initSession();
    expect(store.state.session).not.toBeNull();
  });
});

describe("setNotetaker / setTitle (web)", () => {
  it("setNotetaker writes to localStorage and updates the current session", async () => {
    const store = await loadStore();
    await store.initSession();
    store.setNotetaker("Alice");
    expect(store_localStorage.getItem("oatpad.notetaker")).toBe("Alice");
    expect(store.state.session?.notetaker).toBe("Alice");
  });

  it("setTitle persists the new title back to localStorage", async () => {
    const store = await loadStore();
    await store.initSession();
    store.setTitle("Roadmap review");
    const parsed = JSON.parse(
      store_localStorage.getItem("oatpad.session")!,
    );
    expect(parsed.title).toBe("Roadmap review");
  });
});

describe("hasUnsavedWork", () => {
  it("returns false for a brand-new session that only has session_started", async () => {
    const store = await loadStore();
    await store.initSession();
    expect(store.hasUnsavedWork()).toBe(false);
  });

  it("returns false when the only events are bookkeeping (session_started + file_loaded)", async () => {
    const store = await loadStore();
    await store.initSession();
    store.appendEvents([
      {
        type: "file_loaded",
        id: "f1",
        ts: "2026-04-27T10:00:00.000Z",
        sourceTitle: "old",
      },
    ]);
    expect(store.hasUnsavedWork()).toBe(false);
  });

  it("returns true once a real edit event lands", async () => {
    const store = await loadStore();
    await store.initSession();
    store.appendEvents([
      {
        type: "note_created",
        id: "n1",
        ts: "2026-04-27T10:00:00.000Z",
        noteId: "p1",
        text: "hi",
      },
    ]);
    expect(store.hasUnsavedWork()).toBe(true);
  });
});

describe("noteInput markers", () => {
  it("sets firstInputAt on the first call and bumps lastInputAt on subsequent calls", async () => {
    const store = await loadStore();
    await store.initSession();
    expect(store.state.firstInputAt).toBeNull();
    store.noteInput();
    const first = store.state.firstInputAt;
    expect(first).not.toBeNull();
    expect(store.state.lastInputAt).toBe(first);

    // Force a different timestamp so the bump is observable.
    await new Promise((r) => setTimeout(r, 5));
    store.noteInput();
    expect(store.state.firstInputAt).toBe(first);
    expect(store.state.lastInputAt).not.toBe(first);
  });
});

describe("replaceSessionFromFile", () => {
  it("appends a file_loaded event and adopts the loaded session", async () => {
    const store = await loadStore();
    await store.initSession();
    const file: OatsFile = {
      version: 1,
      sessionId: "loaded-1",
      notetaker: "FromDisk",
      title: "Imported",
      createdAt: "2026-04-26T15:00:00.000Z",
      events: [
        {
          type: "session_started",
          id: "e1",
          ts: "2026-04-26T15:00:00.000Z",
          notetaker: "FromDisk",
        },
        {
          type: "note_created",
          id: "e2",
          ts: "2026-04-26T15:00:01.000Z",
          noteId: "n1",
          text: "imported note",
        },
      ],
      snapshot: { ops: [{ insert: "imported note\n" }] },
      paragraphIds: ["n1"],
    };
    store.replaceSessionFromFile(file);

    expect(store.state.session?.sessionId).toBe("loaded-1");
    const last = store.state.session!.events.at(-1);
    expect(last?.type).toBe("file_loaded");
    if (last?.type === "file_loaded") {
      expect(last.sourceTitle).toBe("Imported");
    }
    // Notetaker was empty before the load — adopt the file's value.
    expect(store.state.notetaker).toBe("FromDisk");
  });

  it("preserves the user's existing notetaker over the file's", async () => {
    const store = await loadStore();
    await store.initSession();
    store.setNotetaker("CurrentUser");

    store.replaceSessionFromFile({
      version: 1,
      sessionId: "loaded-2",
      notetaker: "FileAuthor",
      title: "x",
      createdAt: "2026-04-26T15:00:00.000Z",
      events: [],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    });
    expect(store.state.notetaker).toBe("CurrentUser");
    expect(store.state.session?.notetaker).toBe("CurrentUser");
  });
});

describe("startNewSession", () => {
  it("swaps in a brand-new blank session and clears live input markers", async () => {
    const store = await loadStore();
    await store.initSession();
    const original = store.state.session?.sessionId;
    store.noteInput();
    expect(store.state.firstInputAt).not.toBeNull();

    store.startNewSession();
    expect(store.state.session?.sessionId).not.toBe(original);
    expect(store.state.firstInputAt).toBeNull();
    expect(store.state.lastInputAt).toBeNull();
  });
});

describe("persist quota handling", () => {
  it("flips persistError to 'quota' when localStorage throws QuotaExceededError", async () => {
    const store = await loadStore();
    await store.initSession();
    expect(store.state.persistError).toBeNull();

    // Make subsequent setItem calls throw a quota-shaped DOMException.
    const QuotaError = class extends DOMException {
      constructor() {
        super("quota", "QuotaExceededError");
      }
    };
    const originalSet = store_localStorage.setItem.bind(store_localStorage);
    store_localStorage.setItem = (() => {
      throw new QuotaError();
    }) as typeof store_localStorage.setItem;

    // Quietly swallow the warn() inside persist().
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.setTitle("triggers persist");
    expect(store.state.persistError).toBe("quota");
    warn.mockRestore();

    // Restore so a successful persist clears the flag.
    store_localStorage.setItem = originalSet;
    store.setTitle("now succeeds");
    expect(store.state.persistError).toBeNull();
  });

  it("flips persistError to 'other' for a non-quota error", async () => {
    const store = await loadStore();
    await store.initSession();
    store_localStorage.setItem = (() => {
      throw new Error("disk on fire");
    }) as typeof store_localStorage.setItem;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.setTitle("trigger");
    expect(store.state.persistError).toBe("other");
    warn.mockRestore();
  });
});
