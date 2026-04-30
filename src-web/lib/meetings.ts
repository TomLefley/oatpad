import { BaseDirectory } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { OatsFile } from "./types";
import { cloneOatsFile, parseOatsFile } from "./file";
import { isFreshMode } from "./freshMode";

// Fresh mode keeps meetings in memory only — writes don't hit disk and reads
// come back from this map. The session behaves normally; nothing leaks across
// a relaunch.
const memCache = new Map<string, OatsFile>();

/*
 * Native meeting persistence — one `.oats` file per meeting, living in
 * $APPDATA/meetings/<meetingId>.oats (macOS:
 * ~/Library/Application Support/dev.lefley.oatpad/meetings/).
 *
 * Only used when platform.isNative is true; importing this module in a
 * browser tab will fail at call time because the Tauri fs plugin is absent.
 */

const DIR = "meetings";
const BASE_DIR = BaseDirectory.AppData;

export type MeetingSummary = {
  meetingId: string;
  title: string;
  createdAt: string;
};

async function ensureDir(): Promise<void> {
  if (!(await exists(DIR, { baseDir: BASE_DIR }))) {
    await mkdir(DIR, { baseDir: BASE_DIR, recursive: true });
  }
}

function meetingPath(id: string): string {
  return `${DIR}/${id}.oats`;
}

export async function listMeetings(): Promise<MeetingSummary[]> {
  if (isFreshMode) {
    return Array.from(memCache.values())
      .map((f) => ({
        meetingId: f.meetingId,
        title: f.title,
        createdAt: f.createdAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  await ensureDir();
  const entries = await readDir(DIR, { baseDir: BASE_DIR });
  const summaries: MeetingSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith(".oats")) continue;
    try {
      const text = await readTextFile(`${DIR}/${entry.name}`, { baseDir: BASE_DIR });
      const file = parseOatsFile(text);
      summaries.push({
        meetingId: file.meetingId,
        title: file.title,
        createdAt: file.createdAt,
      });
    } catch {
      // Skip unreadable / malformed files rather than crashing the app.
      continue;
    }
  }
  // Newest first: ISO strings sort lexicographically the same as temporally,
  // so localeCompare(b, a) yields descending order by creation time.
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summaries;
}

export async function loadMeeting(id: string): Promise<OatsFile | null> {
  if (isFreshMode) {
    const cached = memCache.get(id);
    return cached ? cloneOatsFile(cached) : null;
  }
  try {
    const text = await readTextFile(meetingPath(id), { baseDir: BASE_DIR });
    return parseOatsFile(text);
  } catch {
    return null;
  }
}

export async function saveMeeting(file: OatsFile): Promise<void> {
  if (isFreshMode) {
    memCache.set(file.meetingId, cloneOatsFile(file));
    return;
  }
  await ensureDir();
  const json = JSON.stringify(file, null, 2);
  await writeTextFile(meetingPath(file.meetingId), json, { baseDir: BASE_DIR });
}

export async function deleteMeeting(id: string): Promise<void> {
  if (isFreshMode) {
    memCache.delete(id);
    return;
  }
  try {
    await remove(meetingPath(id), { baseDir: BASE_DIR });
  } catch {
    // Swallow missing-file errors — the caller already removed it from state.
  }
}
