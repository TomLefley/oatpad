#!/usr/bin/env node
/*
 * MCP server that exposes oatpad's meeting-note sessions read-only.
 *
 * Sessions live as `<sessionId>.oats` (JSON) inside the macOS app's data
 * directory. We read them at request time — no caching, no watching — so
 * the server always reflects what oatpad has just saved.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const APP_ID = "com.tomlefley.oatpad";

function appDataDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_ID);
  }
  if (process.platform === "win32") {
    const base =
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(base, APP_ID);
  }
  const base =
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, APP_ID);
}

const SESSIONS_DIR = join(appDataDir(), "sessions");

type SessionMeta = {
  sessionId: string;
  title: string;
  displayName: string;
  createdAt: string;
  notetaker: string;
};

type OatsFile = {
  version: 1;
  sessionId: string;
  notetaker: string;
  title: string;
  createdAt: string;
  events: unknown[];
  snapshot: { ops: unknown[] };
  paragraphIds: string[];
};

function isOatsFile(v: unknown): v is OatsFile {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (
    o.version !== 1 ||
    typeof o.sessionId !== "string" ||
    typeof o.notetaker !== "string" ||
    typeof o.title !== "string" ||
    typeof o.createdAt !== "string" ||
    !Array.isArray(o.events) ||
    !Array.isArray(o.paragraphIds)
  ) {
    return false;
  }
  if (!o.snapshot || typeof o.snapshot !== "object") return false;
  const snap = o.snapshot as Record<string, unknown>;
  return Array.isArray(snap.ops);
}

function metaOf(file: OatsFile): SessionMeta {
  const trimmed = file.title.trim();
  return {
    sessionId: file.sessionId,
    title: file.title,
    displayName: trimmed || "meeting",
    createdAt: file.createdAt,
    notetaker: file.notetaker,
  };
}

async function readSessionFile(name: string): Promise<OatsFile | null> {
  try {
    const text = await readFile(join(SESSIONS_DIR, name), "utf8");
    const parsed: unknown = JSON.parse(text);
    return isOatsFile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function listSessions(): Promise<SessionMeta[]> {
  let entries: string[];
  try {
    entries = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }
  const metas: SessionMeta[] = [];
  for (const name of entries) {
    if (!name.endsWith(".oats")) continue;
    const file = await readSessionFile(name);
    if (file) metas.push(metaOf(file));
  }
  // Newest first — ISO strings sort lexicographically by time.
  metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return metas;
}

async function getSession(sessionId: string): Promise<OatsFile | null> {
  // Guard against path traversal — sessionId is meant to be a UUID.
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  return readSessionFile(`${sessionId}.oats`);
}

async function getSessionsInRange(
  start: string,
  end: string,
): Promise<OatsFile[]> {
  // Compare in milliseconds, not by string lexicographic order — string
  // compare breaks when callers pass partial ISO dates like "2026-04-02",
  // which sort *before* "2026-04-02T..." and would wrongly exclude
  // sessions that fell on that day.
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error("`start` and `end` must be ISO 8601 datetimes");
  }
  const lo = Math.min(startMs, endMs);
  const hi = Math.max(startMs, endMs);
  const metas = await listSessions();
  const matched: OatsFile[] = [];
  for (const meta of metas) {
    const ts = Date.parse(meta.createdAt);
    if (Number.isNaN(ts) || ts < lo || ts > hi) continue;
    const file = await readSessionFile(`${meta.sessionId}.oats`);
    if (file) matched.push(file);
  }
  return matched;
}

const server = new Server(
  { name: "oatpad", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_sessions",
      description:
        "List every oatpad meeting-note session, newest first. Each entry has its sessionId, the user-supplied title (empty if unnamed), a displayName that falls back to \"meeting\" when the title is blank, the createdAt ISO timestamp, and the notetaker name.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "get_session",
      description:
        "Retrieve a single oatpad session by id. Returns the full OatsFile JSON (events log + editor snapshot + metadata).",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "The session UUID (the filename stem under sessions/).",
          },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
    },
    {
      name: "get_sessions_in_range",
      description:
        "Retrieve every oatpad session whose createdAt falls within the given ISO 8601 datetime range, inclusive on both ends. Returns full OatsFile JSON for each match, newest first.",
      inputSchema: {
        type: "object",
        properties: {
          start: {
            type: "string",
            description:
              "Lower bound, ISO 8601 datetime (e.g. \"2026-04-01T00:00:00.000Z\").",
          },
          end: {
            type: "string",
            description:
              "Upper bound, ISO 8601 datetime. If end < start the values are swapped.",
          },
        },
        required: ["start", "end"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === "list_sessions") {
    const metas = await listSessions();
    return {
      content: [{ type: "text", text: JSON.stringify(metas, null, 2) }],
    };
  }

  if (name === "get_session") {
    const sessionId = (args as { sessionId?: unknown })?.sessionId;
    if (typeof sessionId !== "string") {
      throw new Error("`sessionId` must be a string");
    }
    const session = await getSession(sessionId);
    if (!session) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `No oatpad session found with id ${JSON.stringify(sessionId)}.`,
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
    };
  }

  if (name === "get_sessions_in_range") {
    const a = args as { start?: unknown; end?: unknown };
    if (typeof a?.start !== "string" || typeof a?.end !== "string") {
      throw new Error("`start` and `end` must both be ISO 8601 strings");
    }
    const sessions = await getSessionsInRange(a.start, a.end);
    return {
      content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
