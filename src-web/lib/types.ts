// Re-export the on-disk schema from the shared module. The Rust side
// has its own struct definition in `src/src/meetings.rs` that mirrors
// these field names — both writers must stay in lockstep on the .oats
// format. In-memory shapes that aren't part of the file format (e.g.
// Paragraph) stay local to src-web.
export type {
  FileLoadedEvent,
  MeetingStartedEvent,
  NoteDeletedEvent,
  NoteUpdatedEvent,
  OatsEvent,
  OatsFile,
  QuillDelta,
  QuillDeltaOp,
} from "../../shared/oats-format";

export type Paragraph = {
  noteId: string;
  markdown: string;
};
