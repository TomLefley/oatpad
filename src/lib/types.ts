export type SessionStartedEvent = {
  type: "session_started";
  id: string;
  ts: string;
  notetaker: string;
};

export type NoteCreatedEvent = {
  type: "note_created";
  id: string;
  ts: string;
  noteId: string;
  text: string;
};

export type NoteEditedEvent = {
  type: "note_edited";
  id: string;
  ts: string;
  noteId: string;
  text: string;
};

export type NoteDeletedEvent = {
  type: "note_deleted";
  id: string;
  ts: string;
  noteId: string;
};

export type FileLoadedEvent = {
  type: "file_loaded";
  id: string;
  ts: string;
  sourceTitle: string;
};

export type OatsEvent =
  | SessionStartedEvent
  | NoteCreatedEvent
  | NoteEditedEvent
  | NoteDeletedEvent
  | FileLoadedEvent;

export type QuillDeltaOp = {
  insert?: string | Record<string, unknown>;
  delete?: number;
  retain?: number | Record<string, unknown>;
  attributes?: Record<string, unknown>;
};

export type QuillDelta = {
  ops: QuillDeltaOp[];
};

export type OatsFile = {
  version: 1;
  sessionId: string;
  notetaker: string;
  title: string;
  createdAt: string;
  events: OatsEvent[];
  snapshot: QuillDelta;
  paragraphIds: string[];
};

export type Paragraph = {
  noteId: string;
  markdown: string;
};
