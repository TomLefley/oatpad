import type { OatsEvent, Paragraph } from "./types";

export type CommitInput = {
  previous: Map<string, string>;
  current: Paragraph[];
  timestamp: string;
  makeId: () => string;
};

export type CommitOutput = {
  events: OatsEvent[];
  nextState: Map<string, string>;
};

export function computeCommit(input: CommitInput): CommitOutput {
  const events: OatsEvent[] = [];
  const nextState = new Map(input.previous);
  const currentIds = new Set<string>();

  for (const p of input.current) {
    currentIds.add(p.noteId);
    const prev = input.previous.get(p.noteId);
    const isWhitespace = p.markdown.trim() === "";

    if (prev === undefined) {
      if (isWhitespace) continue;
      events.push({
        type: "note_created",
        id: input.makeId(),
        ts: input.timestamp,
        noteId: p.noteId,
        text: p.markdown,
      });
      nextState.set(p.noteId, p.markdown);
    } else if (prev !== p.markdown) {
      events.push({
        type: "note_edited",
        id: input.makeId(),
        ts: input.timestamp,
        noteId: p.noteId,
        text: p.markdown,
      });
      nextState.set(p.noteId, p.markdown);
    }
  }

  for (const noteId of input.previous.keys()) {
    if (!currentIds.has(noteId)) {
      events.push({
        type: "note_deleted",
        id: input.makeId(),
        ts: input.timestamp,
        noteId,
      });
      nextState.delete(noteId);
    }
  }

  return { events, nextState };
}
