# Oatpad MCP server

An MCP server that exposes [Oatpad](../README.md) meeting notes to Claude
(or any MCP-compatible client) over stdio. Reads existing meetings; can
also schedule new ones for a future slot.

## Tools

| Tool | What it does |
| --- | --- |
| `list_meetings(titleQuery?, start?, end?, limit?)` | Search/list meeting summaries, newest first. `titleQuery` is a case-insensitive substring matched against the meeting title only — note text is **not** searched, mirroring Oatpad's sidebar. `start`/`end` are ISO 8601 datetime bounds compared against effective time (`scheduledStartAt ?? createdAt`). Each summary includes `meetingId`, `title`, `displayName`, `createdAt`, optional `scheduledStartAt`, `notetaker`, `started` (true once the meeting has any user-written note), and `link` (an `oats://meeting/<id>` URL that opens the meeting in the desktop app). |
| `get_meeting(meetingId)` | One meeting by id. Returns the full `OatsFile` JSON — events log, editor snapshot, paragraph IDs, metadata — augmented with a `link` field (`oats://meeting/<id>`). To search inside note content, pull a meeting with this and inspect its events log. |
| `get_meetings_in_range(start, end, titleQuery?, limit?)` | Full `OatsFile`s for every meeting whose effective time falls in `[start, end]` (ISO 8601, inclusive), each augmented with a `link` field (`oats://meeting/<id>`). Optional `titleQuery` (title-only substring) and `limit`. Newest first. Use this when you need full content for many meetings; otherwise prefer `list_meetings`. |
| `schedule_meeting(title, scheduledStartAt, notetaker?)` | Create a new meeting planned for a specific time. Writes a fresh `.oats` file with the given title and `scheduledStartAt`. Returns the new summary, including an `oats://meeting/<id>` link. Oatpad shows it as scheduled-but-not-started until the user opens it. |

The `oats://` links are handled by the desktop app's deep-link
registration: clicking one (or running `open oats://meeting/<id>` on
macOS) opens that meeting directly in Oatpad. Only resolvable on
machines where the `.app` is installed.

## Where the data lives

The server reads (and, for `schedule_meeting`, writes) `.oats` files in
Oatpad's application-data directory:

- macOS: `~/Library/Application Support/dev.lefley.oatpad/meetings/`
- Linux: `$XDG_DATA_HOME/dev.lefley.oatpad/meetings/` (default `~/.local/share/...`)
- Windows: `%APPDATA%/dev.lefley.oatpad/meetings/`

Existing meetings are never modified — `schedule_meeting` only creates
new files. Oatpad reads the directory on launch and on sidebar refresh,
so a meeting scheduled while the app is open may not appear until the
user reopens it.

## Build

```sh
cd mcp
npm install
npm run pack
```

That compiles `src/` to `server/` and produces `dist/oatpad.mcpb`. Drag
that file into Claude Desktop (Settings → MCP → Install bundle) to
install.

## Local dev

```sh
npm run build
node server/index.js
# then send JSON-RPC over stdin
```
