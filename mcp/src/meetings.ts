/*
 * Pure meeting-reading helpers, factored out of index.ts so they can be
 * unit-tested against a temp directory without spinning up the MCP stdio
 * server.
 *
 * Every function takes the meetings directory as an argument; the caller
 * (index.ts) supplies the per-platform path resolved by appDataDir().
 */
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
  // sync). Absent when the user created the meeting in-app.
  scheduledStartAt?: string;
  notetaker: string;
};

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
  return {
    meetingId: file.meetingId,
    title: file.title,
    displayName: trimmed || "meeting",
    createdAt: file.createdAt,
    ...(file.scheduledStartAt !== undefined
      ? { scheduledStartAt: file.scheduledStartAt }
      : {}),
    notetaker: file.notetaker,
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

export async function listMeetings(dir: string): Promise<MeetingSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const summaries: MeetingSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith(".oats")) continue;
    const file = await readMeetingFile(dir, name);
    if (file) summaries.push(summaryOf(file));
  }
  // Newest first — ISO strings sort lexicographically by time.
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summaries;
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
): Promise<OatsFile[]> {
  // Compare in milliseconds, not by string lexicographic order — string
  // compare breaks when callers pass partial ISO dates like "2026-04-02",
  // which sort *before* "2026-04-02T..." and would wrongly exclude
  // meetings that fell on that day.
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error("`start` and `end` must be ISO 8601 datetimes");
  }
  const lo = Math.min(startMs, endMs);
  const hi = Math.max(startMs, endMs);
  const summaries = await listMeetings(dir);
  const matched: OatsFile[] = [];
  for (const summary of summaries) {
    const ts = Date.parse(summary.createdAt);
    if (Number.isNaN(ts) || ts < lo || ts > hi) continue;
    const file = await readMeetingFile(dir, `${summary.meetingId}.oats`);
    if (file) matched.push(file);
  }
  return matched;
}
