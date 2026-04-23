# oatpad

A meeting notes app with timestamped edit history. Every committed paragraph and every edit is recorded as a wall-clock event, so the notes can later be combined with a transcript by an agent.

See [SPEC.md](./SPEC.md) for product requirements.

## Run

```sh
npm install
npm run dev
```

Open the printed URL.

## Test

```sh
npm test           # unit tests
npm run check      # type check
npm run build      # production build
```

## File format

Notes are saved as `.oats` files (JSON). Structure:

```ts
{
  version: 1,
  sessionId: string,
  notetaker: string,
  title: "meeting - <ISO timestamp>",
  createdAt: string,
  events: OatsEvent[],       // source of truth for history
  snapshot: QuillDelta,      // editor state for reload
  paragraphIds: string[],    // maps snapshot blocks back to noteIds
}
```

Event types: `session_started`, `note_created`, `note_edited`, `note_deleted`, `file_loaded`.

## How capture works

- Quill is the editor — one continuous surface.
- Each paragraph block carries a stable `noteId`.
- An event is committed when a paragraph reaches a natural pause:
  - 3 seconds of idle within the paragraph, or
  - the cursor moves to a different paragraph, or
  - the editor blurs, or
  - the user clicks Save / Open / New.
- A long paragraph written over minutes produces multiple timestamped edits, not one.
