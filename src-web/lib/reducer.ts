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

export type MeetingState = {
  notetaker: string;
  notes: Map<string, NoteState>;
};

export function replay(events: OatsEvent[]): MeetingState {
  const state: MeetingState = {
    notetaker: "",
    notes: new Map(),
  };

  for (const event of events) {
    switch (event.type) {
      case "meeting_started":
        state.notetaker = event.notetaker;
        break;
      case "note_updated": {
        const existing = state.notes.get(event.noteId);
        if (existing) {
          existing.currentText = event.text;
          existing.lastEditedAt = event.ts;
          existing.history.push({ ts: event.ts, text: event.text });
          existing.deleted = false;
        } else {
          state.notes.set(event.noteId, {
            noteId: event.noteId,
            currentText: event.text,
            createdAt: event.ts,
            lastEditedAt: event.ts,
            history: [{ ts: event.ts, text: event.text }],
            deleted: false,
          });
        }
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
      default: {
        // Type-level exhaustiveness check — adding a new OatsEvent variant
        // without a case here is a compile error.
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  }

  return state;
}
