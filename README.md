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
or run the **Release** workflow manually from the Actions tab. Each release
uploads three signed assets that the in-app updater consumes: the `.app.tar.gz`
bundle, its `.sig` file, and `latest.json`.

Tag shape decides whether the release auto-publishes:

- **`vX.Y.Z` (Z > 0)** — patch release. Auto-published; the in-app updater
  picks it up on next launch with no human in the loop.
- **`vX.Y.0`** — major or minor release. Workflow leaves a **draft** in
  GitHub; review the assets / release notes, then publish from the UI.
- Anything else (pre-release suffix, malformed tag) — falls through to
  the draft path so nothing ships unintentionally.

## Updates

Once installed, Oatpad checks GitHub Releases on launch and silently
downloads any newer build. The settings bubble shows the current version
and a refresh button; when an update is staged the version line flips to
**vX.Y.Z available!** and the button becomes **Restart to update**.

### One-time signing-key setup

The Tauri updater rejects unsigned bundles. Before the first signed release
you (the maintainer) must generate a keypair and wire it into CI:

1. Generate the keypair locally — pick a passphrase when prompted:

   ```sh
   npm run tauri signer generate -- -w ~/.tauri/oatpad.key
   ```

2. Copy the printed **public key** into `src/tauri.conf.json` at
   `plugins.updater.pubkey` (replacing the `REPLACE_WITH_…` placeholder)
   and commit it.
3. Add two repository secrets at GitHub → Settings → Secrets → Actions:
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/oatpad.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the passphrase

After that, every tagged release is signed automatically and existing
installs will discover it on next launch. Keep the private key file backed
up — losing it means breaking updates for every existing install.

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
  createdAt: string,         // ISO 8601 — when Oatpad created the meeting
  scheduledStartAt?: string, // ISO 8601 — planned start when set by an external creator (e.g. calendar sync); absent for in-app meetings
  events: OatsEvent[],       // source of truth for history
  snapshot: QuillDelta,      // editor state for reload
  paragraphIds: string[],    // maps snapshot blocks back to noteIds
}
```

Event types: `meeting_started`, `note_updated`, `note_deleted`, `file_loaded`.
Legacy meetings may also contain `note_created`; the parser drops these on
read since they carried no content beyond a timestamp marker.

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

The MCP server runs **inside the Tauri app** (Rust,
`src/src/mcp_server.rs`). When the toggle in Settings is on, it binds
a Unix-domain socket at `~/Library/Application Support/dev.lefley.oatpad/mcp.sock`
and serves four tools (list / fetch / range / schedule). Because it
shares the running app's data directory, scheduled meetings appear in
the sidebar immediately and the toggle starts/stops the listener in
real time.

[`mcp/`](./mcp/README.md) packages a small `.mcpb` bundle that Claude
Desktop loads. The bundle is just a stdio↔Unix-socket proxy — Claude
Desktop talks to it over stdio, it forwards every byte to the running
app and back. If Oatpad isn't open (or the toggle is off) the proxy
returns a friendly JSON-RPC error explaining why.

```sh
just build-mcpb    # produces mcp/dist/oatpad.mcpb
```

Drag the resulting `.mcpb` into Claude Desktop → Settings → MCP →
Install bundle to attach it. Oatpad's Settings cog has a one-click
button that does the same install via Launch Services.

## Project layout

```
src/                Tauri v2 wrapper (Rust + tauri.conf) that produces the macOS .app
src-web/            Svelte 5 + Vite frontend (shared by app + web)
mcp/                Stdio↔Unix-socket proxy packaged as an .mcpb bundle
```
