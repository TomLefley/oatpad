import type { OatsEvent, OatsFile, QuillDelta, QuillDeltaOp } from "./types";
import { isNative } from "./platform";

type FSAWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: {
      description?: string;
      accept: Record<string, string[]>;
    }[];
  }) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: {
    types?: {
      description?: string;
      accept: Record<string, string[]>;
    }[];
    multiple?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
};

const oatsFileTypes = [
  {
    description: "Oatpad notes file",
    accept: { "application/json": [".oats"] },
  },
];

export async function saveFile(file: OatsFile): Promise<boolean> {
  const json = JSON.stringify(file, null, 2);
  const suggestedName = `${suggestedFileBase(file)}.oats`;

  if (isNative) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: "Oatpad notes", extensions: ["oats"] }],
    });
    if (!path) return false;
    await writeTextFile(path, json);
    return true;
  }

  const w = window as FSAWindow;

  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: oatsFileTypes,
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return true;
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return false;
      // fall through to download
    }
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

export type LoadResult =
  | { ok: true; file: OatsFile }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "io"; error: string }
  | { ok: false; reason: "invalid"; error: string };

export async function loadFile(): Promise<LoadResult> {
  if (isNative) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    let text: string;
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Oatpad notes", extensions: ["oats"] }],
      });
      if (!path) return { ok: false, reason: "cancelled" };
      text = await readTextFile(path);
    } catch (err) {
      return {
        ok: false,
        reason: "io",
        error: (err as Error).message ?? "Could not read file",
      };
    }
    return parseResult(text);
  }

  const w = window as FSAWindow;

  if (w.showOpenFilePicker) {
    let text: string;
    try {
      const [handle] = await w.showOpenFilePicker({
        types: oatsFileTypes,
        multiple: false,
      });
      const file = await handle.getFile();
      text = await file.text();
    } catch (err) {
      if ((err as DOMException).name === "AbortError") {
        return { ok: false, reason: "cancelled" };
      }
      return {
        ok: false,
        reason: "io",
        error: (err as Error).message ?? "Could not read file",
      };
    }
    return parseResult(text);
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".oats,application/json";
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      if (!f) return resolve({ ok: false, reason: "cancelled" });
      const text = await f.text();
      resolve(parseResult(text));
    });
    input.click();
  });
}

function parseResult(text: string): LoadResult {
  try {
    const file = parseOatsFile(text);
    return { ok: true, file };
  } catch (err) {
    return {
      ok: false,
      reason: "invalid",
      error: (err as Error).message ?? "Unknown parse error",
    };
  }
}

// Throws if the file is not a well-formed .oats document.
export function parseOatsFile(text: string): OatsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }

  if (!isObject(parsed)) throw new Error("File content is not an object.");
  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported Oatpad file version: ${String(parsed.version)}`,
    );
  }

  requireString(parsed, "meetingId");
  requireString(parsed, "notetaker");
  requireString(parsed, "title");
  requireString(parsed, "createdAt");

  if (!Array.isArray(parsed.events)) {
    throw new Error("`events` must be an array.");
  }
  const events: OatsEvent[] = [];
  parsed.events.forEach((ev, i) => {
    try {
      const validated = validateEvent(ev);
      if (validated) events.push(validated);
    } catch (err) {
      throw new Error(`events[${i}] invalid: ${(err as Error).message}`);
    }
  });

  if (!isObject(parsed.snapshot) || !Array.isArray(parsed.snapshot.ops)) {
    throw new Error("`snapshot.ops` must be an array.");
  }
  const cleanOps = parsed.snapshot.ops.map((op, i) => {
    if (!isObject(op)) {
      throw new Error(`snapshot.ops[${i}] is not an object`);
    }
    return sanitizeOp(op);
  });
  const snapshot: QuillDelta = { ops: cleanOps };

  const rawIds = Array.isArray(parsed.paragraphIds) ? parsed.paragraphIds : [];
  const paragraphIds = rawIds.map((x, i) => {
    if (typeof x !== "string") {
      throw new Error(`paragraphIds[${i}] is not a string`);
    }
    return x;
  });

  return {
    version: 1,
    meetingId: parsed.meetingId as string,
    notetaker: parsed.notetaker as string,
    title: parsed.title as string,
    createdAt: parsed.createdAt as string,
    events,
    snapshot,
    paragraphIds,
  };
}

// Keyed by every OatsEvent variant — TS errors here if the union grows
// but this map isn't updated, which keeps validateEvent's allowlist in
// lockstep with the type.
const EVENT_TYPE_NAMES: Record<OatsEvent["type"], true> = {
  meeting_started: true,
  note_updated: true,
  note_deleted: true,
  file_loaded: true,
};

// Legacy event types that older `.oats` files may still contain. We
// accept them on read but drop them silently — `note_created` carried no
// content beyond a timestamp marker and was retired because empty
// create/delete pairs around accidental keypresses showed up as noise
// in MCP consumers.
const LEGACY_EVENT_TYPES = new Set(["note_created"]);

// Returns null for legacy events that should be silently dropped.
function validateEvent(raw: unknown): OatsEvent | null {
  if (!isObject(raw)) throw new Error("not an object");
  if (typeof raw.type !== "string") {
    throw new Error(`unknown type: ${String(raw.type)}`);
  }
  if (LEGACY_EVENT_TYPES.has(raw.type)) return null;
  if (!(raw.type in EVENT_TYPE_NAMES)) {
    throw new Error(`unknown type: ${String(raw.type)}`);
  }
  if (typeof raw.id !== "string") throw new Error("missing id");
  if (typeof raw.ts !== "string") throw new Error("missing ts");

  switch (raw.type) {
    case "meeting_started":
      if (typeof raw.notetaker !== "string") throw new Error("missing notetaker");
      return raw as unknown as OatsEvent;
    case "note_updated":
      if (typeof raw.noteId !== "string") throw new Error("missing noteId");
      if (typeof raw.text !== "string") throw new Error("missing text");
      return raw as unknown as OatsEvent;
    case "note_deleted":
      if (typeof raw.noteId !== "string") throw new Error("missing noteId");
      return raw as unknown as OatsEvent;
    case "file_loaded":
      if (typeof raw.sourceTitle !== "string") {
        throw new Error("missing sourceTitle");
      }
      return raw as unknown as OatsEvent;
    default:
      throw new Error(`unexpected type: ${String(raw.type)}`);
  }
}

// Strips unsafe link URLs (javascript:, data:, vbscript:, etc.) from a
// Quill Delta op. Keeps everything else intact — Quill's own renderer
// filters unknown formats, so this is just belt-and-braces for the one
// place a malicious file could inject script execution on a click.
function sanitizeOp(op: Record<string, unknown>): QuillDeltaOp {
  const clean: Record<string, unknown> = { ...op };
  if (isObject(op.attributes)) {
    const attrs: Record<string, unknown> = { ...op.attributes };
    const link = attrs.link;
    if (typeof link === "string" && !isSafeUrl(link)) {
      delete attrs.link;
    }
    clean.attributes = Object.keys(attrs).length > 0 ? attrs : undefined;
    if (clean.attributes === undefined) delete clean.attributes;
  }
  return clean as QuillDeltaOp;
}

function isSafeUrl(u: string): boolean {
  return /^(https?:|mailto:|tel:|\/|#|\?)/i.test(u.trim());
}

// Detach an OatsFile from any Svelte $state proxy it might be wrapping.
// JSON round-trip rather than structuredClone — structuredClone trips on
// proxy internals; the on-disk path already JSON-serializes, so this
// keeps the in-memory and on-disk shapes equivalent.
export function cloneOatsFile(file: OatsFile): OatsFile {
  return JSON.parse(JSON.stringify(file)) as OatsFile;
}

export function suggestedFileBase(file: Pick<OatsFile, "title" | "createdAt">): string {
  const name = file.title.trim() || "meeting";
  // Replace characters that break common file systems with a space.
  const safe = name.replace(/[\/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `${safe} - ${file.createdAt}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): void {
  if (typeof obj[key] !== "string") {
    throw new Error(`\`${key}\` must be a string`);
  }
}
