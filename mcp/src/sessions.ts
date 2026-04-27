/*
 * Pure session-reading helpers, factored out of index.ts so they can be
 * unit-tested against a temp directory without spinning up the MCP stdio
 * server.
 *
 * Every function takes the sessions directory as an argument; the caller
 * (index.ts) supplies the per-platform path resolved by appDataDir().
 */
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const APP_ID = "com.tomlefley.oatpad";

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

export type SessionMeta = {
  sessionId: string;
  title: string;
  displayName: string;
  createdAt: string;
  notetaker: string;
};

export type OatsFile = {
  version: 1;
  sessionId: string;
  notetaker: string;
  title: string;
  createdAt: string;
  events: unknown[];
  snapshot: { ops: unknown[] };
  paragraphIds: string[];
};

export function isOatsFile(v: unknown): v is OatsFile {
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

export function metaOf(file: OatsFile): SessionMeta {
  const trimmed = file.title.trim();
  return {
    sessionId: file.sessionId,
    title: file.title,
    displayName: trimmed || "meeting",
    createdAt: file.createdAt,
    notetaker: file.notetaker,
  };
}

export async function readSessionFile(
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

export async function listSessions(dir: string): Promise<SessionMeta[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const metas: SessionMeta[] = [];
  for (const name of entries) {
    if (!name.endsWith(".oats")) continue;
    const file = await readSessionFile(dir, name);
    if (file) metas.push(metaOf(file));
  }
  // Newest first — ISO strings sort lexicographically by time.
  metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return metas;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export async function getSession(
  dir: string,
  sessionId: string,
): Promise<OatsFile | null> {
  // Guard against path traversal — sessionId is meant to be a UUID.
  if (!SAFE_ID.test(sessionId)) return null;
  return readSessionFile(dir, `${sessionId}.oats`);
}

export async function getSessionsInRange(
  dir: string,
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
  const metas = await listSessions(dir);
  const matched: OatsFile[] = [];
  for (const meta of metas) {
    const ts = Date.parse(meta.createdAt);
    if (Number.isNaN(ts) || ts < lo || ts > hi) continue;
    const file = await readSessionFile(dir, `${meta.sessionId}.oats`);
    if (file) matched.push(file);
  }
  return matched;
}
