# oatpad

A meeting notes app with timestamped edit history. Every committed paragraph
and every edit is recorded as a wall-clock event, so the notes can later be
combined with a transcript by an agent.

See [SPEC.md](./SPEC.md) for product requirements.

## Run

oatpad ships in two forms.

**As a Mac native app** (the primary target — autosaves every meeting to disk
and shows them in a left sidebar):

```sh
just run-app      # dev window pointed at Vite
just build-app    # produce src-tauri/target/release/bundle/macos/oatpad.app
```

The bundle is unsigned; first launch requires right-click → Open to bypass
Gatekeeper.

**As a web page** (single in-flight session, explicit Save / Open / New):

```sh
npm install
npm run dev
```

Then open the printed URL.

## Test

```sh
npm test           # unit tests
npm run check      # svelte-check + tsc
npm run build      # production web build
```

## File format

Notes are saved as `.oats` files (JSON):

```ts
{
  version: 1,
  sessionId: string,         // UUID, also the on-disk filename in native mode
  notetaker: string,         // the human's name
  title: string,             // user-supplied meeting name; "" falls back to "meeting" at render
  createdAt: string,         // ISO 8601
  events: OatsEvent[],       // source of truth for history
  snapshot: QuillDelta,      // editor state for reload
  paragraphIds: string[],    // maps snapshot blocks back to noteIds
}
```

Event types: `session_started`, `note_created`, `note_edited`, `note_deleted`,
`file_loaded`.

## How capture works

- Quill is the editor — one continuous surface.
- Each paragraph block carries a stable `noteId`.
- An event is committed when a paragraph reaches a natural pause:
  - 3 seconds of idle within the paragraph, or
  - the cursor moves to a different paragraph, or
  - the editor blurs, or
  - the user starts a new meeting / opens a file / saves.
- A long paragraph written over minutes produces multiple timestamped edits,
  not one.

## Storage

| Mode | Where the data lives |
| --- | --- |
| Native (`.app`) | One `.oats` file per meeting in `~/Library/Application Support/com.tomlefley.oatpad/sessions/`. Autosaves on every mutation, debounced ~400ms. |
| Web | Current session in `localStorage["oatpad.session"]`. Save / Open / New manage `.oats` files via the browser's native dialogs (with a download fallback). |

On first native launch, an existing localStorage session (if any) is migrated
to disk and the localStorage key cleared.

## MCP server

[`mcp/`](./mcp/README.md) packages the meeting data as an MCP bundle for
Claude Desktop and other MCP-compatible clients. Read-only — three tools that
list / fetch / range-query the autosaved meetings on disk.

```sh
just build-mcpb    # produces mcp/dist/oatpad.mcpb (~2.7 MB)
```

Drag the resulting `.mcpb` into Claude Desktop → Settings → MCP → Install
bundle to attach the server.

## Project layout

```
src/                Svelte 5 + Vite frontend (shared by web + native)
src-tauri/          Tauri v2 wrapper that produces the macOS .app
mcp/                Standalone Node MCP server packaged as an .mcpb bundle
```
