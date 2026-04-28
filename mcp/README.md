# Oatpad MCP server

A read-only MCP server that exposes [Oatpad](../README.md) meeting notes
to Claude (or any MCP-compatible client) over stdio.

## Tools

| Tool | What it does |
| --- | --- |
| `list_meetings` | All meetings, newest first. Returns `meetingId`, `title`, `displayName` (falls back to `meeting`), `createdAt`, `notetaker`. |
| `get_meeting(meetingId)` | One meeting by id. Returns the full `OatsFile` JSON — events log, editor snapshot, paragraph IDs, metadata. |
| `get_meetings_in_range(start, end)` | Every meeting whose `createdAt` falls in `[start, end]` (ISO 8601 datetimes, inclusive). Returns full `OatsFile`s, newest first. |

## Where the data lives

The server reads `.oats` files from Oatpad's application-data directory:

- macOS: `~/Library/Application Support/com.tomlefley.oatpad/meetings/`
- Linux: `$XDG_DATA_HOME/com.tomlefley.oatpad/meetings/` (default `~/.local/share/...`)
- Windows: `%APPDATA%/com.tomlefley.oatpad/meetings/`

It only reads — it never writes back, so it can't corrupt anything Oatpad has
saved.

## Build

```sh
cd mcp
npm install
npm run pack
```

That compiles `src/` to `server/` and produces `dist/oatpad.mcpb`. Drag that
file into Claude Desktop (Settings → MCP → Install bundle) to install.

## Local dev

```sh
npm run build
node server/index.js
# then send JSON-RPC over stdin
```
