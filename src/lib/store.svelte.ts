import type { OatsEvent, OatsFile, QuillDelta } from "./types";
import { uuid } from "./ids";
import { isNative } from "./platform";
import type { SessionMeta } from "./sessions";

const LS_KEY = "oatpad.session";
const LS_NOTETAKER = "oatpad.notetaker";

export type Session = {
  version: 1;
  sessionId: string;
  notetaker: string;
  title: string;
  createdAt: string;
  events: OatsEvent[];
  snapshot: QuillDelta;
  paragraphIds: string[];
};

function newSnapshot(): QuillDelta {
  return { ops: [{ insert: "\n" }] };
}

function blankSession(notetaker: string): Session {
  const createdAt = new Date().toISOString();
  const sessionId = uuid();
  return {
    version: 1,
    sessionId,
    notetaker,
    title: "",
    createdAt,
    events: [
      {
        type: "session_started",
        id: uuid(),
        ts: createdAt,
        notetaker,
      },
    ],
    snapshot: newSnapshot(),
    paragraphIds: [],
  };
}

function loadNotetaker(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(LS_NOTETAKER) ?? "";
}

function loadSessionFromLocalStorage(): Session | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const state = $state({
  notetaker: loadNotetaker(),
  session: null as Session | null,
  sessions: [] as SessionMeta[],
  persistError: null as "quota" | "other" | null,
});

export async function initSession(): Promise<void> {
  if (isNative) {
    await initNativeSession();
    return;
  }
  const existing = loadSessionFromLocalStorage();
  if (existing) {
    state.session = existing;
    if (!state.notetaker && existing.notetaker) {
      state.notetaker = existing.notetaker;
    }
    return;
  }
  state.session = blankSession(state.notetaker);
  persist();
}

async function initNativeSession(): Promise<void> {
  const { listSessions, saveSession } = await import("./sessions");
  let metas = await listSessions();

  if (metas.length === 0) {
    // First launch inside the .app. If a single in-flight session happens to
    // be sitting in localStorage (e.g. from a prior web run or the pre-
    // autosave build), migrate it to disk.
    const legacy = loadSessionFromLocalStorage();
    if (legacy) {
      await saveSession(toOatsFileFrom(legacy));
      metas = await listSessions();
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(LS_KEY);
      }
    }
  }

  if (metas.length === 0) {
    const blank = blankSession(state.notetaker);
    state.session = blank;
    await saveSession(toOatsFileFrom(blank));
    state.sessions = [metaOf(blank)];
    return;
  }

  const { loadSession: loadFromDisk } = await import("./sessions");
  const newest = metas[0];
  const loaded = await loadFromDisk(newest.sessionId);
  state.session = loaded ? fileToSession(loaded) : blankSession(state.notetaker);
  if (state.session && !state.notetaker && state.session.notetaker) {
    state.notetaker = state.session.notetaker;
  }
  state.sessions = metas;
}

function fileToSession(file: OatsFile): Session {
  return {
    version: 1,
    sessionId: file.sessionId,
    notetaker: file.notetaker,
    title: file.title,
    createdAt: file.createdAt,
    events: file.events,
    snapshot: file.snapshot,
    paragraphIds: file.paragraphIds,
  };
}

function metaOf(s: Session): SessionMeta {
  return { sessionId: s.sessionId, title: s.title, createdAt: s.createdAt };
}

function refreshCurrentMeta(): void {
  if (!state.session) return;
  const meta = metaOf(state.session);
  const idx = state.sessions.findIndex((m) => m.sessionId === meta.sessionId);
  if (idx === -1) {
    state.sessions = [meta, ...state.sessions];
  } else {
    state.sessions[idx] = meta;
  }
}

export function setNotetaker(name: string): void {
  state.notetaker = name;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LS_NOTETAKER, name);
  }
  if (state.session) {
    state.session.notetaker = name;
    persist();
  }
}

export function setTitle(title: string): void {
  if (!state.session) return;
  state.session.title = title;
  if (isNative) refreshCurrentMeta();
  persist();
}

export function appendEvents(events: OatsEvent[]): void {
  if (!state.session) return;
  if (events.length === 0) return;
  state.session.events.push(...events);
  persist();
}

export function setSnapshot(snapshot: QuillDelta, paragraphIds: string[]): void {
  if (!state.session) return;
  state.session.snapshot = snapshot;
  state.session.paragraphIds = paragraphIds;
  persist();
}

export function startNewSession(): void {
  state.session = blankSession(state.notetaker);
  if (isNative) {
    // Add to sidebar immediately; the debounced persist will land shortly.
    state.sessions = [metaOf(state.session), ...state.sessions];
  }
  persist();
}

export async function switchSession(id: string): Promise<void> {
  if (!isNative) return;
  if (state.session?.sessionId === id) return;
  await flushPersist();
  const { loadSession } = await import("./sessions");
  const file = await loadSession(id);
  if (!file) return;
  state.session = fileToSession(file);
}

export async function deleteSessionById(id: string): Promise<void> {
  if (!isNative) return;
  const wasCurrent = state.session?.sessionId === id;
  if (wasCurrent) {
    // Never leave the UI session-less.
    state.session = blankSession(state.notetaker);
  }
  state.sessions = state.sessions.filter((m) => m.sessionId !== id);
  await flushPersist();
  const { deleteSession, saveSession } = await import("./sessions");
  await deleteSession(id);
  if (wasCurrent && state.session) {
    await saveSession(toOatsFileFrom(state.session));
    refreshCurrentMeta();
  }
}

export function replaceSessionFromFile(file: OatsFile): void {
  const loadedAt = new Date().toISOString();
  state.session = {
    ...file,
    events: [
      ...file.events,
      {
        type: "file_loaded",
        id: uuid(),
        ts: loadedAt,
        sourceTitle: file.title,
      },
    ],
  };
  if (state.notetaker && state.session.notetaker !== state.notetaker) {
    state.session.notetaker = state.notetaker;
  } else if (!state.notetaker && file.notetaker) {
    state.notetaker = file.notetaker;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_NOTETAKER, file.notetaker);
    }
  }
  persist();
}

export function hasUnsavedWork(): boolean {
  if (!state.session) return false;
  return state.session.events.some(
    (e) => e.type !== "session_started" && e.type !== "file_loaded",
  );
}

let persistWarned = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 400;

function persist(): void {
  if (!state.session) return;
  if (isNative) {
    scheduleNativePersist();
    return;
  }
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.session));
    state.persistError = null;
    persistWarned = false;
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" ||
        err.name === "NS_ERROR_DOM_QUOTA_REACHED");
    state.persistError = isQuota ? "quota" : "other";
    if (!persistWarned) {
      console.warn("oatpad: autosave to localStorage failed", err);
      persistWarned = true;
    }
  }
}

function scheduleNativePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeCurrentSessionToDisk();
  }, SAVE_DEBOUNCE_MS);
}

async function writeCurrentSessionToDisk(): Promise<void> {
  if (!state.session) return;
  try {
    const { saveSession } = await import("./sessions");
    await saveSession(toOatsFileFrom(state.session));
    state.persistError = null;
  } catch (err) {
    state.persistError = "other";
    if (!persistWarned) {
      console.warn("oatpad: autosave to disk failed", err);
      persistWarned = true;
    }
  }
}

export async function flushPersist(): Promise<void> {
  if (!isNative) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await writeCurrentSessionToDisk();
}

function toOatsFileFrom(s: Session): OatsFile {
  const {
    version,
    sessionId,
    notetaker,
    title,
    createdAt,
    events,
    snapshot,
    paragraphIds,
  } = s;
  return {
    version,
    sessionId,
    notetaker,
    title,
    createdAt,
    events,
    snapshot,
    paragraphIds,
  };
}

export function toOatsFile(): OatsFile | null {
  if (!state.session) return null;
  return toOatsFileFrom(state.session);
}

// Flush any pending autosave before the window closes.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    void flushPersist();
  });
}
