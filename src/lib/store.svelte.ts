import type { OatsEvent, OatsFile, QuillDelta } from "./types";
import { uuid } from "./ids";

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

function titleForNow(): string {
  return `meeting - ${new Date().toISOString()}`;
}

function blankSession(notetaker: string): Session {
  const createdAt = new Date().toISOString();
  const sessionId = uuid();
  return {
    version: 1,
    sessionId,
    notetaker,
    title: titleForNow(),
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

function loadSession(): Session | null {
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
  persistError: null as "quota" | "other" | null,
});

export function initSession(): void {
  const existing = loadSession();
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
  persist();
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

function persist(): void {
  if (typeof localStorage === "undefined") return;
  if (!state.session) return;
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

export function toOatsFile(): OatsFile | null {
  if (!state.session) return null;
  const {
    version,
    sessionId,
    notetaker,
    title,
    createdAt,
    events,
    snapshot,
    paragraphIds,
  } = state.session;
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
