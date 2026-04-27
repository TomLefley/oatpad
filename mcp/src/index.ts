#!/usr/bin/env node
/*
 * MCP server that exposes oatpad's meeting-note sessions read-only.
 *
 * Sessions live as `<sessionId>.oats` (JSON) inside the macOS app's data
 * directory. We read them at request time — no caching, no watching — so
 * the server always reflects what oatpad has just saved.
 *
 * The actual session-reading logic lives in ./sessions.ts so it can be
 * unit-tested without bringing up an stdio transport.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { join } from "node:path";
import {
  appDataDir,
  getSession,
  getSessionsInRange,
  listSessions,
} from "./sessions.js";

const SESSIONS_DIR = join(appDataDir(), "sessions");

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
    const metas = await listSessions(SESSIONS_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(metas, null, 2) }],
    };
  }

  if (name === "get_session") {
    const sessionId = (args as { sessionId?: unknown })?.sessionId;
    if (typeof sessionId !== "string") {
      throw new Error("`sessionId` must be a string");
    }
    const session = await getSession(SESSIONS_DIR, sessionId);
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
    const sessions = await getSessionsInRange(SESSIONS_DIR, a.start, a.end);
    return {
      content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
