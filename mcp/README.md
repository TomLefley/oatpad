# Oatpad MCP

A small `.mcpb` bundle that bridges Claude Desktop to the MCP server
running **inside the Oatpad app**.

## How it works

The actual MCP server is written in Rust and lives in the Tauri app
(`src/src/mcp_server.rs`). When the toggle in Settings is on, the app
binds a Unix-domain socket at:

- macOS: `~/Library/Application Support/dev.lefley.oatpad/mcp.sock`
- Linux: `$XDG_DATA_HOME/dev.lefley.oatpad/mcp.sock`
- Windows: `%APPDATA%/dev.lefley.oatpad/mcp.sock`

The bundle in this folder packages a tiny Node proxy
(`src/index.ts` → `server/index.js`) that Claude Desktop spawns over
stdio. The proxy connects to that socket and shovels JSON-RPC frames
both ways — it does no protocol work of its own.

If the socket isn't there (Oatpad isn't running, or the user turned
the MCP toggle off) the proxy synthesises a friendly JSON-RPC error
for each incoming request so Claude Desktop's UI explains the
situation instead of silently dropping the connection.

## Tools

The same tool set the previous file-based bundle exposed, now served
by the in-app server:

| Tool | What it does |
| --- | --- |
| `list_meetings(titleQuery?, start?, end?, limit?)` | Search/list meeting summaries, newest first. `titleQuery` is a case-insensitive substring matched against the meeting title only — note text is **not** searched, mirroring Oatpad's sidebar. `start`/`end` are ISO 8601 datetime bounds compared against effective time (`scheduledStartAt ?? createdAt`). Each summary includes `meetingId`, `title`, `displayName`, `createdAt`, optional `scheduledStartAt`, `notetaker`, `started`, and a `link` (`oats://meeting/<id>`). |
| `get_meeting(meetingId)` | Full `OatsFile` JSON for one meeting, augmented with a `link` field. |
| `get_meetings_in_range(start, end, titleQuery?, limit?)` | Full `OatsFile`s in a window, each augmented with a `link` field. Newest first. |
| `schedule_meeting(title, scheduledStartAt, notetaker?)` | Create a new meeting planned for a specific time. Because the server is in-process, the new meeting appears in Oatpad's sidebar immediately. |

The `oats://` links are handled by the desktop app's deep-link
registration: clicking one (or running `open oats://meeting/<id>` on
macOS) opens that meeting directly in Oatpad.

## Build

```sh
cd mcp
npm install
npm run pack
```

That compiles `src/` to `server/` and produces `dist/oatpad.mcpb`.
Drag that file into Claude Desktop (Settings → MCP → Install bundle)
to install. Oatpad's Settings cog has a one-click button that does
the same install via Launch Services.

The bundle is tiny — a few hundred lines of Node that bridge stdio to
a Unix socket. There is no MCP protocol work or meeting logic in it;
everything lives in the running app.

## Local dev

The proxy is testable on its own:

```sh
npm test
```

The tests spin up a fake socket server, drive the proxy with in-memory
streams, and verify request forwarding plus the unreachable-server
error path.

To exercise it end-to-end, run Oatpad (`just run`, or `just build` ➝
launch the .app), then run the proxy against the live socket:

```sh
node mcp/server/index.js
# then send JSON-RPC over stdin
```
