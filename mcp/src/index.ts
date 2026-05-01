#!/usr/bin/env node
/*
 * MCP server that exposes Oatpad's meeting notes read-only.
 *
 * Meetings live as `<meetingId>.oats` (JSON) inside the macOS app's data
 * directory. We read them at request time — no caching, no watching — so
 * the server always reflects what Oatpad has just saved.
 *
 * The actual meeting-reading logic lives in ./meetings.ts so it can be
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
  getMeeting,
  getMeetingsInRange,
  isMcpEnabled,
  listMeetings,
} from "./meetings.js";

const APP_DATA = appDataDir();
const MEETINGS_DIR = join(APP_DATA, "meetings");

const DISABLED_RESPONSE = {
  isError: true,
  content: [
    {
      type: "text",
      text: "Oatpad's MCP server is disabled. Enable it from the settings cog in the Oatpad app to access meetings.",
    },
  ],
};

const server = new Server(
  { name: "Oatpad", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_meetings",
      description:
        "List every Oatpad meeting, newest first. Each entry has its meetingId, the user-supplied title (empty if unnamed), a displayName that falls back to \"meeting\" when the title is blank, the createdAt ISO timestamp, and the notetaker name.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "get_meeting",
      description:
        "Retrieve a single Oatpad meeting by id. Returns the full OatsFile JSON (events log + editor snapshot + metadata). Note events are: `note_created` (one per noteId, no text — marks the moment a paragraph appeared); `note_updated` (zero-or-more per noteId, carries the full text at a settled checkpoint — emitted when the user pauses for ~1.5s after crossing a word boundary while editing, when they leave the note, or when they substitute a complete word; rapid edit-rewrite bursts coalesce into a single event capturing the latest settled text rather than each intermediate boundary); `note_deleted` (when the paragraph is removed).",
      inputSchema: {
        type: "object",
        properties: {
          meetingId: {
            type: "string",
            description: "The meeting UUID (the filename stem under meetings/).",
          },
        },
        required: ["meetingId"],
        additionalProperties: false,
      },
    },
    {
      name: "get_meetings_in_range",
      description:
        "Retrieve every Oatpad meeting whose createdAt falls within the given ISO 8601 datetime range, inclusive on both ends. Returns full OatsFile JSON for each match, newest first.",
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

  if (!(await isMcpEnabled(APP_DATA))) {
    return DISABLED_RESPONSE;
  }

  if (name === "list_meetings") {
    const summaries = await listMeetings(MEETINGS_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(summaries, null, 2) }],
    };
  }

  if (name === "get_meeting") {
    const meetingId = (args as { meetingId?: unknown })?.meetingId;
    if (typeof meetingId !== "string") {
      throw new Error("`meetingId` must be a string");
    }
    const meeting = await getMeeting(MEETINGS_DIR, meetingId);
    if (!meeting) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `No Oatpad meeting found with id ${JSON.stringify(meetingId)}.`,
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(meeting, null, 2) }],
    };
  }

  if (name === "get_meetings_in_range") {
    const a = args as { start?: unknown; end?: unknown };
    if (typeof a?.start !== "string" || typeof a?.end !== "string") {
      throw new Error("`start` and `end` must both be ISO 8601 strings");
    }
    const meetings = await getMeetingsInRange(MEETINGS_DIR, a.start, a.end);
    return {
      content: [{ type: "text", text: JSON.stringify(meetings, null, 2) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
