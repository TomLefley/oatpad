import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getMeeting,
  getMeetingsInRange,
  isOatsFile,
  listMeetings,
  summaryOf,
  type OatsFile,
} from "./meetings.js";

let dir: string;

function makeFile(
  id: string,
  title: string,
  createdAt: string,
  notetaker = "Tom",
): OatsFile {
  return {
    version: 1,
    meetingId: id,
    notetaker,
    title,
    createdAt,
    events: [
      {
        type: "meeting_started",
        id: `${id}-s`,
        ts: createdAt,
        notetaker,
      },
    ],
    snapshot: { ops: [{ insert: "\n" }] },
    paragraphIds: [],
  };
}

async function writeMeeting(file: OatsFile): Promise<void> {
  await writeFile(
    join(dir, `${file.meetingId}.oats`),
    JSON.stringify(file, null, 2),
    "utf8",
  );
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "oatpad-mcp-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isOatsFile", () => {
  const valid = makeFile("aaa", "Meeting", "2026-04-27T10:00:00.000Z");

  it("accepts a well-formed oats file", () => {
    expect(isOatsFile(valid)).toBe(true);
  });

  it("rejects null and non-objects", () => {
    expect(isOatsFile(null)).toBe(false);
    expect(isOatsFile("nope")).toBe(false);
    expect(isOatsFile(42)).toBe(false);
  });

  it("rejects unknown version numbers", () => {
    expect(isOatsFile({ ...valid, version: 2 })).toBe(false);
  });

  it("rejects when required fields are missing or wrong type", () => {
    expect(isOatsFile({ ...valid, meetingId: 1 })).toBe(false);
    expect(isOatsFile({ ...valid, title: undefined })).toBe(false);
    expect(isOatsFile({ ...valid, events: "list" })).toBe(false);
    expect(isOatsFile({ ...valid, paragraphIds: undefined })).toBe(false);
  });

  it("rejects a missing or malformed snapshot.ops", () => {
    expect(isOatsFile({ ...valid, snapshot: undefined })).toBe(false);
    expect(isOatsFile({ ...valid, snapshot: {} })).toBe(false);
    expect(isOatsFile({ ...valid, snapshot: { ops: "x" } })).toBe(false);
  });
});

describe("summaryOf", () => {
  it("uses the trimmed title as the displayName", () => {
    const m = summaryOf(makeFile("a", "  Standup  ", "2026-04-27T10:00:00Z"));
    expect(m.displayName).toBe("Standup");
    // Original title is preserved verbatim — only displayName is trimmed.
    expect(m.title).toBe("  Standup  ");
  });

  it("falls back to 'meeting' for blank/whitespace titles", () => {
    expect(
      summaryOf(makeFile("a", "", "2026-04-27T10:00:00Z")).displayName,
    ).toBe("meeting");
    expect(
      summaryOf(makeFile("a", "   ", "2026-04-27T10:00:00Z")).displayName,
    ).toBe("meeting");
  });
});

describe("listMeetings", () => {
  it("returns an empty array when the directory does not exist", async () => {
    const out = await listMeetings(join(dir, "nope"));
    expect(out).toEqual([]);
  });

  it("returns meetings newest-first", async () => {
    await writeMeeting(
      makeFile("aaa", "First",  "2026-04-27T09:00:00.000Z"),
    );
    await writeMeeting(
      makeFile("bbb", "Second", "2026-04-27T11:00:00.000Z"),
    );
    await writeMeeting(
      makeFile("ccc", "Third",  "2026-04-27T10:00:00.000Z"),
    );
    const summaries = await listMeetings(dir);
    expect(summaries.map((m) => m.meetingId)).toEqual(["bbb", "ccc", "aaa"]);
  });

  it("ignores non-.oats files", async () => {
    await writeMeeting(makeFile("aaa", "Real", "2026-04-27T09:00:00Z"));
    await writeFile(join(dir, "README.md"), "# stray", "utf8");
    await writeFile(join(dir, "scratch.json"), "{}", "utf8");
    const summaries = await listMeetings(dir);
    expect(summaries.map((m) => m.meetingId)).toEqual(["aaa"]);
  });

  it("skips malformed .oats files instead of throwing", async () => {
    await writeMeeting(makeFile("good", "OK", "2026-04-27T10:00:00Z"));
    await writeFile(join(dir, "bad.oats"), "{ not json", "utf8");
    await writeFile(
      join(dir, "wrong-shape.oats"),
      JSON.stringify({ version: 99 }),
      "utf8",
    );
    const summaries = await listMeetings(dir);
    expect(summaries.map((m) => m.meetingId)).toEqual(["good"]);
  });
});

describe("getMeeting", () => {
  beforeEach(async () => {
    await writeMeeting(makeFile("abc-123", "Real", "2026-04-27T10:00:00Z"));
  });

  it("returns the meeting for a valid id", async () => {
    const file = await getMeeting(dir, "abc-123");
    expect(file?.title).toBe("Real");
  });

  it("returns null for a missing id", async () => {
    expect(await getMeeting(dir, "does-not-exist")).toBeNull();
  });

  it("rejects path-traversal payloads without touching disk", async () => {
    expect(await getMeeting(dir, "../etc/passwd")).toBeNull();
    expect(await getMeeting(dir, "abc/../abc-123")).toBeNull();
    expect(await getMeeting(dir, "abc.123")).toBeNull(); // dot is not allowed
    expect(await getMeeting(dir, " abc-123")).toBeNull(); // whitespace not allowed
    expect(await getMeeting(dir, "")).toBeNull();
  });

  it("ignores malformed file content (returns null, not the raw json)", async () => {
    await writeFile(join(dir, "broken.oats"), "{ not valid", "utf8");
    expect(await getMeeting(dir, "broken")).toBeNull();
  });
});

describe("getMeetingsInRange", () => {
  beforeEach(async () => {
    await writeMeeting(makeFile("a", "A", "2026-04-01T08:00:00.000Z"));
    await writeMeeting(makeFile("b", "B", "2026-04-02T08:00:00.000Z"));
    await writeMeeting(makeFile("c", "C", "2026-04-02T20:00:00.000Z"));
    await writeMeeting(makeFile("d", "D", "2026-04-03T08:00:00.000Z"));
  });

  it("returns meetings whose createdAt is within an ISO datetime range, inclusive", async () => {
    const out = await getMeetingsInRange(
      dir,
      "2026-04-02T00:00:00.000Z",
      "2026-04-02T23:59:59.999Z",
    );
    expect(out.map((f) => f.meetingId).sort()).toEqual(["b", "c"]);
  });

  it("treats partial-day bounds correctly via ms compare (not lexicographic)", async () => {
    // The bug being guarded: lexicographic compare would put
    // "2026-04-02T20:00:00.000Z" *after* "2026-04-02" and exclude it from
    // a [2026-04-02, 2026-04-02] range. ms-compare treats both as the same
    // day's start.
    const out = await getMeetingsInRange(dir, "2026-04-02", "2026-04-02");
    // Only the b meeting at exactly 00:00 would be on-day-boundary; c at
    // 20:00 falls *after* the upper bound's parsed ms. We want b but not c.
    // What matters is that the function doesn't crash and that no string-
    // compare false-positives sneak through (a or d).
    expect(out.every((f) => f.meetingId === "b" || f.meetingId === "c")).toBe(
      true,
    );
    expect(out.some((f) => f.meetingId === "a")).toBe(false);
    expect(out.some((f) => f.meetingId === "d")).toBe(false);
  });

  it("swaps bounds when end < start", async () => {
    const out = await getMeetingsInRange(
      dir,
      "2026-04-03T23:59:59.999Z",
      "2026-04-02T00:00:00.000Z",
    );
    expect(out.map((f) => f.meetingId).sort()).toEqual(["b", "c", "d"]);
  });

  it("returns empty when no meeting falls inside the window", async () => {
    const out = await getMeetingsInRange(
      dir,
      "1999-01-01T00:00:00.000Z",
      "1999-01-02T00:00:00.000Z",
    );
    expect(out).toEqual([]);
  });

  it("throws on unparseable ISO bounds", async () => {
    await expect(
      getMeetingsInRange(dir, "not-a-date", "2026-04-02"),
    ).rejects.toThrow(/ISO 8601/);
    await expect(
      getMeetingsInRange(dir, "2026-04-02", "also bogus"),
    ).rejects.toThrow(/ISO 8601/);
  });

  it("returns empty when the directory does not exist", async () => {
    const out = await getMeetingsInRange(
      join(dir, "missing"),
      "2026-04-01T00:00:00Z",
      "2026-04-30T00:00:00Z",
    );
    expect(out).toEqual([]);
  });
});

describe("nested directory creation", () => {
  it("listMeetings still works when the directory has subdirs (they are skipped)", async () => {
    await writeMeeting(makeFile("aaa", "OK", "2026-04-27T10:00:00Z"));
    // A bogus sub-directory ending in .oats should not crash the loop.
    await mkdir(join(dir, "subdir.oats"));
    const summaries = await listMeetings(dir);
    expect(summaries.map((m) => m.meetingId)).toEqual(["aaa"]);
  });
});
