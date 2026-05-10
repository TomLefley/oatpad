#!/usr/bin/env node
/*
 * MCP server that exposes Oatpad's meeting notes.
 *
 * Reads `<meetingId>.oats` (JSON) files from the macOS app's data directory
 * at request time — no caching, no watching — so the server always reflects
 * what Oatpad has just saved. Also lets clients schedule new meetings by
 * writing a fresh `.oats` envelope with a `scheduledStartAt` slot; the app
 * picks those up the next time it reads the meetings directory.
 *
 * Tool logic lives in ./meetings.ts so it can be unit-tested without
 * bringing up an stdio transport.
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
  meetingLink,
  scheduleMeeting,
  type MeetingFilter,
  type OatsFile,
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
  { name: "Oatpad", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_meetings",
      description:
        "Search and list Oatpad meeting summaries, newest first by effective time (scheduledStartAt when set, else createdAt). All filters are optional and combine with AND. Each summary has: meetingId, title (verbatim), displayName (\"meeting\" when title is blank), createdAt (ISO), optional scheduledStartAt (ISO; present when an external creator like a calendar sync or schedule_meeting planned the slot), notetaker, started (true once the meeting has any user-written note — useful for spotting upcoming-but-not-yet-started meetings), and link (an `oats://meeting/<id>` URL that opens the meeting in the desktop app). Search is title-only here, matching Oatpad's sidebar. Use this for discovery; call get_meeting to fetch the full content of a specific entry, or get_meetings_in_range when you want full content for many meetings at once.",
      inputSchema: {
        type: "object",
        properties: {
          titleQuery: {
            type: "string",
            description:
              "Case-insensitive substring matched against the meeting title only. Mirrors Oatpad's sidebar search — note text is not searched here. To search inside note content, fetch a meeting with get_meeting and inspect its events log.",
          },
          start: {
            type: "string",
            description:
              "ISO 8601 datetime lower bound (e.g. \"2026-04-01\" or \"2026-04-01T00:00:00.000Z\"). Compared against effective time = scheduledStartAt ?? createdAt.",
          },
          end: {
            type: "string",
            description:
              "ISO 8601 datetime upper bound, inclusive. If end < start the values are swapped.",
          },
          limit: {
            type: "integer",
            minimum: 0,
            description:
              "Maximum summaries to return after sorting newest-first. Useful when you only need the most recent few.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_meeting",
      description:
        "Retrieve a single Oatpad meeting by id. Returns the full OatsFile JSON (events log + editor snapshot + metadata) plus a synthetic `link` field — an `oats://meeting/<id>` URL that opens the meeting in the desktop app. Note events are: `note_updated` (zero-or-more per noteId, carries the full text at a settled checkpoint — emitted when the user pauses for ~1.5s after crossing a word boundary while editing, when they leave the note, or when they substitute a complete word; rapid edit-rewrite bursts coalesce into a single event capturing the latest settled text rather than each intermediate boundary); `note_deleted` (when the paragraph is removed; only fires for paragraphs that previously emitted at least one `note_updated`, so phantom paragraphs from accidental keypresses leave no trace). Legacy meetings may also contain `note_created` (a content-less paragraph-appeared marker) — treat as informational only.",
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
        "Retrieve full OatsFile JSON for every Oatpad meeting whose effective time (scheduledStartAt ?? createdAt) falls within the given ISO 8601 datetime range, inclusive on both ends. Returns full content, newest first, each entry augmented with an `oats://meeting/<id>` link that opens it in the desktop app. Prefer list_meetings for browsing — only reach for this when you genuinely need the events log or editor snapshot for many meetings at once.",
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
          titleQuery: {
            type: "string",
            description:
              "Optional case-insensitive substring matched against the meeting title only. Note text is not searched.",
          },
          limit: {
            type: "integer",
            minimum: 0,
            description:
              "Optional cap on returned meetings (newest first).",
          },
        },
        required: ["start", "end"],
        additionalProperties: false,
      },
    },
    {
      name: "schedule_meeting",
      description:
        "Create a new Oatpad meeting planned for a specific time. Writes a fresh `.oats` file with the given title and scheduledStartAt; Oatpad's sidebar will show it as scheduled-but-not-started until the user opens it. The app reads the meetings directory on launch and on sidebar refresh, so a meeting scheduled while Oatpad is open may not appear until the user reopens it. Returns the new meeting's summary — including the generated meetingId and a `link` (`oats://meeting/<id>`) that opens it in the desktop app.",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "Human-readable name for the meeting. Required, must be non-empty after trimming.",
          },
          scheduledStartAt: {
            type: "string",
            description:
              "Planned start time as an ISO 8601 datetime (e.g. \"2026-06-15T14:00:00.000Z\"). Stored after round-tripping through Date so loose ISO forms are normalized to UTC.",
          },
          notetaker: {
            type: "string",
            description:
              "Optional name to record on the file. Defaults to empty — the user's existing notetaker (set in Oatpad's settings) takes over once they open the meeting.",
          },
        },
        required: ["title", "scheduledStartAt"],
        additionalProperties: false,
      },
    },
  ],
}));

// Adds a synthetic `link` field to an OatsFile response so clients can
// surface a clickable `oats://meeting/<id>` URL alongside the meeting
// content. The link is derived at response time, not stored on disk.
function withLink(file: OatsFile): OatsFile & { link: string } {
  return { ...file, link: meetingLink(file.meetingId) };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asInteger(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isInteger(v)) return undefined;
  return v;
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (!(await isMcpEnabled(APP_DATA))) {
    return DISABLED_RESPONSE;
  }

  if (name === "list_meetings") {
    const a = (args ?? {}) as Record<string, unknown>;
    const filter: MeetingFilter = {};
    if (a.titleQuery !== undefined) {
      const q = asString(a.titleQuery);
      if (q === undefined) throw new Error("`titleQuery` must be a string");
      filter.titleQuery = q;
    }
    if (a.start !== undefined) {
      const s = asString(a.start);
      if (s === undefined) throw new Error("`start` must be a string");
      filter.start = s;
    }
    if (a.end !== undefined) {
      const e = asString(a.end);
      if (e === undefined) throw new Error("`end` must be a string");
      filter.end = e;
    }
    if (a.limit !== undefined) {
      const l = asInteger(a.limit);
      if (l === undefined || l < 0) {
        throw new Error("`limit` must be a non-negative integer");
      }
      filter.limit = l;
    }
    const summaries = await listMeetings(MEETINGS_DIR, filter);
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
      content: [
        { type: "text", text: JSON.stringify(withLink(meeting), null, 2) },
      ],
    };
  }

  if (name === "get_meetings_in_range") {
    const a = (args ?? {}) as Record<string, unknown>;
    const start = asString(a.start);
    const end = asString(a.end);
    if (start === undefined || end === undefined) {
      throw new Error("`start` and `end` must both be ISO 8601 strings");
    }
    const options: { titleQuery?: string; limit?: number } = {};
    if (a.titleQuery !== undefined) {
      const q = asString(a.titleQuery);
      if (q === undefined) throw new Error("`titleQuery` must be a string");
      options.titleQuery = q;
    }
    if (a.limit !== undefined) {
      const l = asInteger(a.limit);
      if (l === undefined || l < 0) {
        throw new Error("`limit` must be a non-negative integer");
      }
      options.limit = l;
    }
    const meetings = await getMeetingsInRange(MEETINGS_DIR, start, end, options);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(meetings.map(withLink), null, 2),
        },
      ],
    };
  }

  if (name === "schedule_meeting") {
    const a = (args ?? {}) as Record<string, unknown>;
    const title = asString(a.title);
    const scheduledStartAt = asString(a.scheduledStartAt);
    if (title === undefined) throw new Error("`title` must be a string");
    if (scheduledStartAt === undefined) {
      throw new Error("`scheduledStartAt` must be a string");
    }
    const notetaker =
      a.notetaker !== undefined ? asString(a.notetaker) : undefined;
    if (a.notetaker !== undefined && notetaker === undefined) {
      throw new Error("`notetaker` must be a string when provided");
    }
    const summary = await scheduleMeeting(MEETINGS_DIR, {
      title,
      scheduledStartAt,
      ...(notetaker !== undefined ? { notetaker } : {}),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
