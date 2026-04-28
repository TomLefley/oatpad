import type { OatsEvent, OatsFile, QuillDelta } from "./types";
import { uuid } from "./ids";
import { isNative } from "./platform";
import { isFreshMode } from "./freshMode";
import type { MeetingSummary } from "./meetings";

const LS_KEY = "oatpad.meeting";
const LS_NOTETAKER = "oatpad.notetaker";

export type Meeting = {
  version: 1;
  meetingId: string;
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

function blankMeeting(notetaker: string): Meeting {
  const createdAt = new Date().toISOString();
  const meetingId = uuid();
  return {
    version: 1,
    meetingId,
    notetaker,
    title: "",
    createdAt,
    events: [
      {
        type: "meeting_started",
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
  if (isFreshMode) return "";
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(LS_NOTETAKER) ?? "";
}

function loadMeetingFromLocalStorage(): Meeting | null {
  if (isFreshMode) return null;
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Meeting;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const state = $state({
  notetaker: loadNotetaker(),
  meeting: null as Meeting | null,
  meetings: [] as MeetingSummary[],
  persistError: null as "quota" | "other" | null,
  // Live input markers — bumped on every keystroke, independent of the
  // editor's debounced commit. They give the meeting-meta header a reactive
  // signal so the start time and progress indicator can update immediately,
  // not 3s later when the first batch of events flushes. Not persisted.
  firstInputAt: null as string | null,
  lastInputAt: null as string | null,
});

export function noteInput(): void {
  const ts = new Date().toISOString();
  if (!state.firstInputAt) state.firstInputAt = ts;
  state.lastInputAt = ts;
}

function clearInputMarkers(): void {
  state.firstInputAt = null;
  state.lastInputAt = null;
}

export async function initMeeting(): Promise<void> {
  clearInputMarkers();
  if (isNative) {
    await initNativeMeeting();
    return;
  }
  const existing = loadMeetingFromLocalStorage();
  if (existing) {
    state.meeting = existing;
    if (!state.notetaker && existing.notetaker) {
      state.notetaker = existing.notetaker;
    }
    return;
  }
  // No saved meeting — leave state.meeting null and let the UI render the
  // Getting Started view. Persisting only happens once the user creates one.
  state.meeting = null;
}

async function initNativeMeeting(): Promise<void> {
  const { listMeetings } = await import("./meetings");
  let summaries = await listMeetings();

  if (summaries.length === 0) {
    // First launch inside the .app. If a single in-flight meeting happens to
    // be sitting in localStorage (e.g. from a prior web run or the pre-
    // autosave build), migrate it to disk.
    const legacy = loadMeetingFromLocalStorage();
    if (legacy) {
      const { saveMeeting } = await import("./meetings");
      await saveMeeting(toOatsFileFrom(legacy));
      summaries = await listMeetings();
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(LS_KEY);
      }
    }
  }

  if (summaries.length === 0) {
    // No meetings on disk and no legacy payload to migrate — leave the state
    // null so the Getting Started view renders. The first user-created meeting
    // gets persisted via startNewMeeting.
    state.meeting = null;
    state.meetings = [];
    return;
  }

  const { loadMeeting: loadFromDisk } = await import("./meetings");
  const newest = summaries[0];
  const loaded = await loadFromDisk(newest.meetingId);
  state.meeting = loaded ? fileToMeeting(loaded) : null;
  if (state.meeting && !state.notetaker && state.meeting.notetaker) {
    state.notetaker = state.meeting.notetaker;
  }
  state.meetings = summaries;
}

function fileToMeeting(file: OatsFile): Meeting {
  return {
    version: 1,
    meetingId: file.meetingId,
    notetaker: file.notetaker,
    title: file.title,
    createdAt: file.createdAt,
    events: file.events,
    snapshot: file.snapshot,
    paragraphIds: file.paragraphIds,
  };
}

function summaryOf(m: Meeting): MeetingSummary {
  return { meetingId: m.meetingId, title: m.title, createdAt: m.createdAt };
}

function refreshCurrentSummary(): void {
  if (!state.meeting) return;
  const summary = summaryOf(state.meeting);
  const idx = state.meetings.findIndex((m) => m.meetingId === summary.meetingId);
  if (idx === -1) {
    state.meetings = [summary, ...state.meetings];
  } else {
    state.meetings[idx] = summary;
  }
}

export function setNotetaker(name: string): void {
  state.notetaker = name;
  if (!isFreshMode && typeof localStorage !== "undefined") {
    localStorage.setItem(LS_NOTETAKER, name);
  }
  if (state.meeting) {
    state.meeting.notetaker = name;
    persist();
  }
}

export function setTitle(title: string): void {
  if (!state.meeting) return;
  state.meeting.title = title;
  if (isNative) refreshCurrentSummary();
  persist();
}

export function appendEvents(events: OatsEvent[]): void {
  if (!state.meeting) return;
  if (events.length === 0) return;
  state.meeting.events.push(...events);
  persist();
}

export function setSnapshot(snapshot: QuillDelta, paragraphIds: string[]): void {
  if (!state.meeting) return;
  state.meeting.snapshot = snapshot;
  state.meeting.paragraphIds = paragraphIds;
  persist();
}

export function startNewMeeting(): void {
  clearInputMarkers();
  state.meeting = blankMeeting(state.notetaker);
  if (isNative) {
    // Add to sidebar immediately; the debounced persist will land shortly.
    state.meetings = [summaryOf(state.meeting), ...state.meetings];
  }
  persist();
}

export async function switchMeeting(id: string): Promise<void> {
  if (!isNative) return;
  if (state.meeting?.meetingId === id) return;
  await flushPersist();
  const { loadMeeting } = await import("./meetings");
  const file = await loadMeeting(id);
  if (!file) return;
  clearInputMarkers();
  state.meeting = fileToMeeting(file);
}

export async function deleteMeetingById(id: string): Promise<void> {
  if (!isNative) return;
  const wasCurrent = state.meeting?.meetingId === id;
  const remaining = state.meetings.filter((m) => m.meetingId !== id);
  state.meetings = remaining;

  if (wasCurrent) {
    clearInputMarkers();
    if (remaining.length > 0) {
      // Hand the user the next-most-recent meeting rather than nothing.
      // `state.meetings` is kept newest-first, so [0] is correct.
      const { loadMeeting } = await import("./meetings");
      const file = await loadMeeting(remaining[0].meetingId);
      state.meeting = file ? fileToMeeting(file) : null;
    } else {
      // No meetings left — clear state.meeting and let the Getting Started
      // view render. No phantom blank gets persisted.
      state.meeting = null;
    }
  }

  await flushPersist();
  const { deleteMeeting } = await import("./meetings");
  await deleteMeeting(id);
}

export function replaceMeetingFromFile(file: OatsFile): void {
  clearInputMarkers();
  const loadedAt = new Date().toISOString();
  state.meeting = {
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
  if (state.notetaker && state.meeting.notetaker !== state.notetaker) {
    state.meeting.notetaker = state.notetaker;
  } else if (!state.notetaker && file.notetaker) {
    state.notetaker = file.notetaker;
    if (!isFreshMode && typeof localStorage !== "undefined") {
      localStorage.setItem(LS_NOTETAKER, file.notetaker);
    }
  }
  persist();
}

export function hasUnsavedWork(): boolean {
  if (!state.meeting) return false;
  return state.meeting.events.some(
    (e) => e.type !== "meeting_started" && e.type !== "file_loaded",
  );
}

let persistWarned = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 400;

function persist(): void {
  if (!state.meeting) return;
  if (isNative) {
    scheduleNativePersist();
    return;
  }
  if (isFreshMode) return;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.meeting));
    state.persistError = null;
    persistWarned = false;
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" ||
        err.name === "NS_ERROR_DOM_QUOTA_REACHED");
    state.persistError = isQuota ? "quota" : "other";
    if (!persistWarned) {
      console.warn("Oatpad: autosave to localStorage failed", err);
      persistWarned = true;
    }
  }
}

function scheduleNativePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeCurrentMeetingToDisk();
  }, SAVE_DEBOUNCE_MS);
}

async function writeCurrentMeetingToDisk(): Promise<void> {
  if (!state.meeting) return;
  try {
    const { saveMeeting } = await import("./meetings");
    await saveMeeting(toOatsFileFrom(state.meeting));
    state.persistError = null;
  } catch (err) {
    state.persistError = "other";
    if (!persistWarned) {
      console.warn("Oatpad: autosave to disk failed", err);
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
  await writeCurrentMeetingToDisk();
}

function toOatsFileFrom(m: Meeting): OatsFile {
  const {
    version,
    meetingId,
    notetaker,
    title,
    createdAt,
    events,
    snapshot,
    paragraphIds,
  } = m;
  return {
    version,
    meetingId,
    notetaker,
    title,
    createdAt,
    events,
    snapshot,
    paragraphIds,
  };
}

export function toOatsFile(): OatsFile | null {
  if (!state.meeting) return null;
  return toOatsFileFrom(state.meeting);
}

// Flush any pending autosave before the window closes.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    void flushPersist();
  });
}
