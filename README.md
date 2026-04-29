# Oatpad

A meeting notes app with timestamped edit history. Every committed paragraph
and every edit is recorded as a wall-clock event, so the notes can later be
combined with a transcript by an agent.

See [SPEC.md](./SPEC.md) for product requirements.

## Install

Download the latest macOS build from the
[Releases](https://github.com/TomLefley/oatpad/releases) page (universal `.dmg`
covering Apple Silicon and Intel). The bundle is unsigned, so the first launch
needs right-click → Open to bypass Gatekeeper.

To cut a new release, push a `v*` tag (e.g. `git tag v0.1.0 && git push --tags`)
or run the **Release** workflow manually from the Actions tab. The workflow
publishes a **draft** release — review the assets, then publish from the GitHub
UI.

## Run

Oatpad's primary form is a **Mac native app** — autosaves every meeting to
disk and shows them in a left sidebar:

```sh
just run        # dev window pointed at Vite
just build      # produce src/target/release/bundle/macos/Oatpad.app
```

The bundle is unsigned; first launch requires right-click → Open to bypass
Gatekeeper.

It also runs as a **web page** (single in-flight meeting, explicit Save / Open
/ New):

```sh
just run-web    # vite dev server
just build-web  # static build into dist/
```

## Test

```sh
just test       # unit tests (frontend + mcp)
just check      # svelte-check + tsc
just build-web  # production web build
```

## File format

Notes are saved as `.oats` files (JSON):

```ts
{
  version: 1,
  meetingId: string,         // UUID, also the on-disk filename in native mode
  notetaker: string,         // the human's name
  title: string,             // user-supplied meeting name; "" falls back to "meeting" at render
  createdAt: string,         // ISO 8601
  events: OatsEvent[],       // source of truth for history
  snapshot: QuillDelta,      // editor state for reload
  paragraphIds: string[],    // maps snapshot blocks back to noteIds
}
```

Event types: `meeting_started`, `note_created`, `note_edited`, `note_deleted`,
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
| Native (`.app`) | One `.oats` file per meeting in `~/Library/Application Support/dev.lefley.oatpad/meetings/`. Autosaves on every mutation, debounced ~400ms. |
| Web | Current meeting in `localStorage["oatpad.meeting"]`. Save / Open / New manage `.oats` files via the browser's native dialogs (with a download fallback). |

On first native launch, an existing localStorage meeting (if any) is migrated
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
src/                Tauri v2 wrapper (Rust + tauri.conf) that produces the macOS .app
src-web/            Svelte 5 + Vite frontend (shared by app + web)
mcp/                Standalone Node MCP server packaged as an .mcpb bundle
```
