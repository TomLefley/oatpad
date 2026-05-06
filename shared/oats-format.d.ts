// Canonical on-disk schema for `.oats` files. Shared by the Vite/Svelte
// runtime (src-web/) and the Node MCP server (mcp/). Declared as a .d.ts
// so neither package emits a corresponding .js — the file is purely type
// information.
//
// Runtime validation lives where it always has:
//   - src-web/lib/file.ts `parseOatsFile()` for the Svelte side.
//   - mcp/src/meetings.ts `isOatsFile()` for the MCP side (envelope only —
//     events stay opaque on this side; consumers read them).

export type MeetingStartedEvent = {
  type: "meeting_started";
  id: string;
  ts: string;
  notetaker: string;
};

export type NoteUpdatedEvent = {
  type: "note_updated";
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
  | MeetingStartedEvent
  | NoteUpdatedEvent
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
  meetingId: string;
  notetaker: string;
  title: string;
  // Wall-clock time at which Oatpad created the meeting. Always present.
  createdAt: string;
  // Optional planned start time, set by external tools that create
  // meetings in advance (e.g. a calendar sync). Absent when the user
  // creates a meeting in-app.
  scheduledStartAt?: string;
  events: OatsEvent[];
  snapshot: QuillDelta;
  paragraphIds: string[];
};
