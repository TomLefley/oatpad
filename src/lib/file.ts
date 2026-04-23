import type { OatsEvent, OatsFile, QuillDelta, QuillDeltaOp } from "./types";

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
    description: "oatpad notes file",
    accept: { "application/json": [".oats"] },
  },
];

export async function saveFile(file: OatsFile): Promise<boolean> {
  const json = JSON.stringify(file, null, 2);
  const suggestedName = `${file.title}.oats`;
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
  | { ok: false; reason: "invalid"; error: string };

export async function loadFile(): Promise<LoadResult> {
  const w = window as FSAWindow;

  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: oatsFileTypes,
        multiple: false,
      });
      const file = await handle.getFile();
      const text = await file.text();
      return parseResult(text);
    } catch (err) {
      if ((err as DOMException).name === "AbortError") {
        return { ok: false, reason: "cancelled" };
      }
      return {
        ok: false,
        reason: "invalid",
        error: (err as Error).message ?? "Could not open file",
      };
    }
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
      `Unsupported oatpad file version: ${String(parsed.version)}`,
    );
  }

  requireString(parsed, "sessionId");
  requireString(parsed, "notetaker");
  requireString(parsed, "title");
  requireString(parsed, "createdAt");

  if (!Array.isArray(parsed.events)) {
    throw new Error("`events` must be an array.");
  }
  const events: OatsEvent[] = parsed.events.map((ev, i) => {
    try {
      return validateEvent(ev);
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
    sessionId: parsed.sessionId as string,
    notetaker: parsed.notetaker as string,
    title: parsed.title as string,
    createdAt: parsed.createdAt as string,
    events,
    snapshot,
    paragraphIds,
  };
}

const EVENT_TYPES = new Set([
  "session_started",
  "note_created",
  "note_edited",
  "note_deleted",
  "file_loaded",
]);

function validateEvent(raw: unknown): OatsEvent {
  if (!isObject(raw)) throw new Error("not an object");
  if (typeof raw.type !== "string" || !EVENT_TYPES.has(raw.type)) {
    throw new Error(`unknown type: ${String(raw.type)}`);
  }
  if (typeof raw.id !== "string") throw new Error("missing id");
  if (typeof raw.ts !== "string") throw new Error("missing ts");

  switch (raw.type) {
    case "session_started":
      if (typeof raw.notetaker !== "string") throw new Error("missing notetaker");
      return raw as unknown as OatsEvent;
    case "note_created":
    case "note_edited":
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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): void {
  if (typeof obj[key] !== "string") {
    throw new Error(`\`${key}\` must be a string`);
  }
}
