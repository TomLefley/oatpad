// Re-export the on-disk schema from the shared module so src-web and the
// MCP server can't drift on the file format. In-memory shapes that aren't
// part of the file format (e.g. Paragraph) stay local to src-web.
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
