/*
 * Pure meeting helpers, factored out of index.ts so they can be unit-tested
 * against a temp directory without spinning up the MCP stdio server.
 *
 * Every function takes the meetings directory as an argument; the caller
 * (index.ts) supplies the per-platform path resolved by appDataDir().
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { OatsFile } from "../../shared/oats-format";

export type { OatsFile };

const APP_ID = "dev.lefley.oatpad";

export function appDataDir(): string {
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

// Reads the mcpEnabled toggle from `$APPDATA/dev.lefley.oatpad/config.json`.
// The file is owned by the Oatpad app's settings UI; missing/malformed
// config is treated as enabled so the server doesn't lock itself out
// before the app has ever written one.
export async function isMcpEnabled(appData: string): Promise<boolean> {
  try {
    const text = await readFile(join(appData, "config.json"), "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return true;
    const v = (parsed as { mcpEnabled?: unknown }).mcpEnabled;
    return v !== false;
  } catch {
    return true;
  }
}

export type MeetingSummary = {
  meetingId: string;
  title: string;
  displayName: string;
  createdAt: string;
  // Planned start time supplied by an external creator (e.g. calendar
  // sync, schedule_meeting). Absent when the user created the meeting
  // in-app without scheduling it.
  scheduledStartAt?: string;
  notetaker: string;
  // True once the meeting contains any user-written note (a
  // `note_updated` or `note_deleted` event). Bookkeeping events
  // (`meeting_started`, `file_loaded`) don't flip this — they fire
  // before the user has typed.
  started: boolean;
  // Custom-protocol URL that opens this meeting in the Oatpad desktop
  // app. Registered on macOS via tauri-plugin-deep-link.
  link: string;
};

// Custom URL scheme registered by the desktop app. Mirrors the
// constant in `src-web/lib/deepLink.ts`; both must agree on the form.
export function meetingLink(meetingId: string): string {
  return `oats://meeting/${meetingId}`;
}

export function isOatsFile(v: unknown): v is OatsFile {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (
    o.version !== 1 ||
    typeof o.meetingId !== "string" ||
    typeof o.notetaker !== "string" ||
    typeof o.title !== "string" ||
    typeof o.createdAt !== "string" ||
    !Array.isArray(o.events) ||
    !Array.isArray(o.paragraphIds)
  ) {
    return false;
  }
  if (
    o.scheduledStartAt !== undefined &&
    typeof o.scheduledStartAt !== "string"
  ) {
    return false;
  }
  if (!o.snapshot || typeof o.snapshot !== "object") return false;
  const snap = o.snapshot as Record<string, unknown>;
  return Array.isArray(snap.ops);
}

export function summaryOf(file: OatsFile): MeetingSummary {
  const trimmed = file.title.trim();
  const started = file.events.some(
    (e) => e.type === "note_updated" || e.type === "note_deleted",
  );
  return {
    meetingId: file.meetingId,
    title: file.title,
    displayName: trimmed || "meeting",
    createdAt: file.createdAt,
    ...(file.scheduledStartAt !== undefined
      ? { scheduledStartAt: file.scheduledStartAt }
      : {}),
    notetaker: file.notetaker,
    started,
    link: meetingLink(file.meetingId),
  };
}

export async function readMeetingFile(
  dir: string,
  name: string,
): Promise<OatsFile | null> {
  try {
    const text = await readFile(join(dir, name), "utf8");
    const parsed: unknown = JSON.parse(text);
    return isOatsFile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readAllOatsFiles(dir: string): Promise<OatsFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files: OatsFile[] = [];
  for (const name of entries) {
    if (!name.endsWith(".oats")) continue;
    const file = await readMeetingFile(dir, name);
    if (file) files.push(file);
  }
  return files;
}

// The "effective time" of a meeting: the planned start when set, else
// the creation time. Mirrors the app's sidebar sort key so a meeting
// scheduled in advance sits next to other meetings in the same slot
// rather than floating up to its creation moment.
export function effectiveTime(file: OatsFile): string {
  return file.scheduledStartAt ?? file.createdAt;
}

export type MeetingFilter = {
  // Case-insensitive substring match against the meeting title only —
  // mirroring Oatpad's sidebar search so MCP results match what the
  // user can find by typing the same query in the app. Note text is
  // not searched; callers who need that should fetch with get_meeting
  // and search the events log themselves.
  titleQuery?: string;
  // ISO 8601 datetime bounds, inclusive on both ends. Compared against
  // `effectiveTime(file)` (scheduledStartAt ?? createdAt) so scheduled
  // meetings appear in the slot they were planned for.
  start?: string;
  end?: string;
  limit?: number;
};

function matchesTitleQuery(
  file: OatsFile,
  titleQuery: string | undefined,
): boolean {
  if (!titleQuery) return true;
  return file.title.toLowerCase().includes(titleQuery.toLowerCase());
}

function parseRange(filter: MeetingFilter): {
  lo: number | null;
  hi: number | null;
} {
  let lo: number | null = null;
  let hi: number | null = null;
  if (filter.start !== undefined) {
    const ms = Date.parse(filter.start);
    if (Number.isNaN(ms)) {
      throw new Error("`start` must be an ISO 8601 datetime");
    }
    lo = ms;
  }
  if (filter.end !== undefined) {
    const ms = Date.parse(filter.end);
    if (Number.isNaN(ms)) {
      throw new Error("`end` must be an ISO 8601 datetime");
    }
    hi = ms;
  }
  if (lo !== null && hi !== null && lo > hi) {
    [lo, hi] = [hi, lo];
  }
  return { lo, hi };
}

function matchesRange(
  file: OatsFile,
  lo: number | null,
  hi: number | null,
): boolean {
  if (lo === null && hi === null) return true;
  // Compare in milliseconds, not lexicographically — string compare
  // breaks when callers pass partial ISO dates like "2026-04-02",
  // which sort *before* "2026-04-02T..." and would wrongly exclude
  // meetings that fell on that day.
  const ts = Date.parse(effectiveTime(file));
  if (Number.isNaN(ts)) return false;
  if (lo !== null && ts < lo) return false;
  if (hi !== null && ts > hi) return false;
  return true;
}

function applyFilter(files: OatsFile[], filter: MeetingFilter): OatsFile[] {
  const { lo, hi } = parseRange(filter);
  let result = files.filter(
    (f) => matchesRange(f, lo, hi) && matchesTitleQuery(f, filter.titleQuery),
  );
  // Newest-first by effective time. ISO strings compare temporally.
  result.sort((a, b) => effectiveTime(b).localeCompare(effectiveTime(a)));
  if (filter.limit !== undefined && filter.limit >= 0) {
    result = result.slice(0, filter.limit);
  }
  return result;
}

export async function listMeetings(
  dir: string,
  filter: MeetingFilter = {},
): Promise<MeetingSummary[]> {
  const all = await readAllOatsFiles(dir);
  return applyFilter(all, filter).map(summaryOf);
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export async function getMeeting(
  dir: string,
  meetingId: string,
): Promise<OatsFile | null> {
  // Guard against path traversal — meetingId is meant to be a UUID.
  if (!SAFE_ID.test(meetingId)) return null;
  return readMeetingFile(dir, `${meetingId}.oats`);
}

export async function getMeetingsInRange(
  dir: string,
  start: string,
  end: string,
  options: { titleQuery?: string; limit?: number } = {},
): Promise<OatsFile[]> {
  const all = await readAllOatsFiles(dir);
  return applyFilter(all, { start, end, ...options });
}

export type ScheduleArgs = {
  title: string;
  scheduledStartAt: string;
  notetaker?: string;
};

// Creates a new `.oats` file representing a meeting planned for a
// future (or past) slot. The shape mirrors the app's `blankMeeting`:
// a single `meeting_started` event at createdAt, an empty editor
// snapshot, no paragraph IDs. The app picks it up on next launch (or
// on next sidebar refresh) and renders it as scheduled-but-not-started
// until the user opens it and types.
export async function scheduleMeeting(
  dir: string,
  args: ScheduleArgs,
): Promise<MeetingSummary> {
  const title = args.title.trim();
  if (!title) {
    throw new Error("`title` must not be empty");
  }
  const ms = Date.parse(args.scheduledStartAt);
  if (Number.isNaN(ms)) {
    throw new Error("`scheduledStartAt` must be an ISO 8601 datetime");
  }
  // Round-trip through Date so callers can pass loose ISO forms
  // ("2026-05-08T14:00") and we still persist a fully-qualified UTC
  // timestamp.
  const scheduledStartAt = new Date(ms).toISOString();
  const notetaker = (args.notetaker ?? "").trim();
  const meetingId = randomUUID();
  const createdAt = new Date().toISOString();
  const file: OatsFile = {
    version: 1,
    meetingId,
    notetaker,
    title,
    createdAt,
    scheduledStartAt,
    events: [
      {
        type: "meeting_started",
        id: randomUUID(),
        ts: createdAt,
        notetaker,
      },
    ],
    snapshot: { ops: [{ insert: "\n" }] },
    paragraphIds: [],
  };
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${meetingId}.oats`),
    JSON.stringify(file, null, 2),
    "utf8",
  );
  return summaryOf(file);
}
