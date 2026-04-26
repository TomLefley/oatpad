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
import { parseOatsFile } from "./file";

/*
 * Native session persistence — one `.oats` file per session, living in
 * $APPDATA/sessions/<sessionId>.oats (macOS:
 * ~/Library/Application Support/com.tomlefley.oatpad/sessions/).
 *
 * Only used when platform.isNative is true; importing this module in a
 * browser tab will fail at call time because the Tauri fs plugin is absent.
 */

const DIR = "sessions";
const BASE_DIR = BaseDirectory.AppData;

export type SessionMeta = {
  sessionId: string;
  title: string;
  createdAt: string;
};

async function ensureDir(): Promise<void> {
  if (!(await exists(DIR, { baseDir: BASE_DIR }))) {
    await mkdir(DIR, { baseDir: BASE_DIR, recursive: true });
  }
}

function sessionPath(id: string): string {
  return `${DIR}/${id}.oats`;
}

export async function listSessions(): Promise<SessionMeta[]> {
  await ensureDir();
  const entries = await readDir(DIR, { baseDir: BASE_DIR });
  const metas: SessionMeta[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith(".oats")) continue;
    try {
      const text = await readTextFile(`${DIR}/${entry.name}`, { baseDir: BASE_DIR });
      const file = parseOatsFile(text);
      metas.push({
        sessionId: file.sessionId,
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
  metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return metas;
}

export async function loadSession(id: string): Promise<OatsFile | null> {
  try {
    const text = await readTextFile(sessionPath(id), { baseDir: BASE_DIR });
    return parseOatsFile(text);
  } catch {
    return null;
  }
}

export async function saveSession(file: OatsFile): Promise<void> {
  await ensureDir();
  const json = JSON.stringify(file, null, 2);
  await writeTextFile(sessionPath(file.sessionId), json, { baseDir: BASE_DIR });
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await remove(sessionPath(id), { baseDir: BASE_DIR });
  } catch {
    // Swallow missing-file errors — the caller already removed it from state.
  }
}
