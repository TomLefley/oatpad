import type { OatsEvent } from "./types";

export type NoteHistoryEntry = {
  ts: string;
  text: string;
};

export type NoteState = {
  noteId: string;
  currentText: string;
  createdAt: string;
  lastEditedAt: string;
  history: NoteHistoryEntry[];
  deleted: boolean;
};

export type SessionState = {
  notetaker: string;
  notes: Map<string, NoteState>;
};

export function replay(events: OatsEvent[]): SessionState {
  const state: SessionState = {
    notetaker: "",
    notes: new Map(),
  };

  for (const event of events) {
    switch (event.type) {
      case "session_started":
        state.notetaker = event.notetaker;
        break;
      case "note_created":
        state.notes.set(event.noteId, {
          noteId: event.noteId,
          currentText: event.text,
          createdAt: event.ts,
          lastEditedAt: event.ts,
          history: [{ ts: event.ts, text: event.text }],
          deleted: false,
        });
        break;
      case "note_edited": {
        const existing = state.notes.get(event.noteId);
        if (!existing) break;
        existing.currentText = event.text;
        existing.lastEditedAt = event.ts;
        existing.history.push({ ts: event.ts, text: event.text });
        existing.deleted = false;
        break;
      }
      case "note_deleted": {
        const existing = state.notes.get(event.noteId);
        if (!existing) break;
        existing.deleted = true;
        existing.lastEditedAt = event.ts;
        break;
      }
      case "file_loaded":
        break;
    }
  }

  return state;
}
