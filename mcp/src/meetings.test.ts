import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  effectiveTime,
  getMeeting,
  getMeetingsInRange,
  isMcpEnabled,
  isOatsFile,
  listMeetings,
  meetingLink,
  scheduleMeeting,
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

function withNote(file: OatsFile, noteId: string, text: string): OatsFile {
  return {
    ...file,
    events: [
      ...file.events,
      {
        type: "note_updated",
        id: `${file.meetingId}-${noteId}`,
        ts: file.createdAt,
        noteId,
        text,
      },
    ],
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

  it("accepts an optional scheduledStartAt string", () => {
    expect(
      isOatsFile({ ...valid, scheduledStartAt: "2026-04-27T09:30:00.000Z" }),
    ).toBe(true);
  });

  it("rejects a non-string scheduledStartAt", () => {
    expect(isOatsFile({ ...valid, scheduledStartAt: 123 })).toBe(false);
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

  it("includes scheduledStartAt only when present on the file", () => {
    const without = summaryOf(makeFile("a", "M", "2026-04-27T10:00:00Z"));
    expect("scheduledStartAt" in without).toBe(false);

    const file = makeFile("a", "M", "2026-04-27T10:00:00Z");
    file.scheduledStartAt = "2026-04-27T09:30:00.000Z";
    const withSched = summaryOf(file);
    expect(withSched.scheduledStartAt).toBe("2026-04-27T09:30:00.000Z");
  });

  it("reports started=false when only bookkeeping events are present", () => {
    const m = summaryOf(makeFile("a", "M", "2026-04-27T10:00:00Z"));
    expect(m.started).toBe(false);
  });

  it("reports started=true once any note_updated event exists", () => {
    const file = withNote(
      makeFile("a", "M", "2026-04-27T10:00:00Z"),
      "p1",
      "hello",
    );
    expect(summaryOf(file).started).toBe(true);
  });

  it("reports started=true when only a note_deleted event exists", () => {
    const base = makeFile("a", "M", "2026-04-27T10:00:00Z");
    const file: OatsFile = {
      ...base,
      events: [
        ...base.events,
        {
          type: "note_deleted",
          id: "a-d",
          ts: base.createdAt,
          noteId: "p1",
        },
      ],
    };
    expect(summaryOf(file).started).toBe(true);
  });

  it("includes an oats://meeting/<id> deep link", () => {
    const m = summaryOf(makeFile("abc-123", "M", "2026-04-27T10:00:00Z"));
    expect(m.link).toBe("oats://meeting/abc-123");
  });
});

describe("meetingLink", () => {
  it("formats an `oats://meeting/<id>` URL", () => {
    expect(meetingLink("abc-123")).toBe("oats://meeting/abc-123");
  });
});

describe("effectiveTime", () => {
  it("falls back to createdAt when scheduledStartAt is absent", () => {
    const f = makeFile("a", "M", "2026-04-27T10:00:00Z");
    expect(effectiveTime(f)).toBe("2026-04-27T10:00:00Z");
  });

  it("prefers scheduledStartAt when set", () => {
    const f = makeFile("a", "M", "2026-04-27T10:00:00Z");
    f.scheduledStartAt = "2026-05-01T09:00:00.000Z";
    expect(effectiveTime(f)).toBe("2026-05-01T09:00:00.000Z");
  });
});

describe("listMeetings", () => {
  it("returns an empty array when the directory does not exist", async () => {
    const out = await listMeetings(join(dir, "nope"));
    expect(out).toEqual([]);
  });

  it("returns meetings newest-first by effective time", async () => {
    await writeMeeting(makeFile("aaa", "First", "2026-04-27T09:00:00.000Z"));
    await writeMeeting(makeFile("bbb", "Second", "2026-04-27T11:00:00.000Z"));
    await writeMeeting(makeFile("ccc", "Third", "2026-04-27T10:00:00.000Z"));
    const summaries = await listMeetings(dir);
    expect(summaries.map((m) => m.meetingId)).toEqual(["bbb", "ccc", "aaa"]);
  });

  it("sorts by scheduledStartAt when present", async () => {
    // Created late, scheduled early — should appear ahead of a meeting
    // created earlier but with no schedule.
    const scheduled = makeFile("sched", "Future", "2026-04-27T11:00:00Z");
    scheduled.scheduledStartAt = "2026-05-01T09:00:00.000Z";
    await writeMeeting(scheduled);
    await writeMeeting(makeFile("now", "Now", "2026-04-27T10:00:00Z"));
    const summaries = await listMeetings(dir);
    expect(summaries.map((m) => m.meetingId)).toEqual(["sched", "now"]);
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

  describe("filter.titleQuery", () => {
    beforeEach(async () => {
      await writeMeeting(makeFile("a", "Weekly Standup", "2026-04-01T10:00:00Z"));
      await writeMeeting(makeFile("b", "Roadmap review", "2026-04-02T10:00:00Z"));
      await writeMeeting(
        withNote(
          makeFile("c", "1:1 with Jess", "2026-04-03T10:00:00Z"),
          "p1",
          "Discussed the Q3 roadmap and team capacity",
        ),
      );
    });

    it("matches case-insensitively against the title", async () => {
      const out = await listMeetings(dir, { titleQuery: "STANDUP" });
      expect(out.map((m) => m.meetingId)).toEqual(["a"]);
    });

    it("matches the title only — never the note text", async () => {
      // `c`'s title is "1:1 with Jess" but its notes mention "roadmap" and
      // "capacity". A title-only filter must not surface either as a hit.
      // This guards parity with the app's sidebar search, which is also
      // title-only.
      const roadmap = await listMeetings(dir, { titleQuery: "roadmap" });
      expect(roadmap.map((m) => m.meetingId)).toEqual(["b"]);

      const capacity = await listMeetings(dir, { titleQuery: "capacity" });
      expect(capacity).toEqual([]);
    });

    it("returns an empty array when nothing matches", async () => {
      const out = await listMeetings(dir, { titleQuery: "no-such-thing" });
      expect(out).toEqual([]);
    });
  });

  describe("filter.start / filter.end", () => {
    beforeEach(async () => {
      await writeMeeting(makeFile("a", "A", "2026-04-01T08:00:00.000Z"));
      await writeMeeting(makeFile("b", "B", "2026-04-02T08:00:00.000Z"));
      await writeMeeting(makeFile("c", "C", "2026-04-02T20:00:00.000Z"));
      await writeMeeting(makeFile("d", "D", "2026-04-03T08:00:00.000Z"));
    });

    it("filters to summaries whose effective time is in [start, end]", async () => {
      const out = await listMeetings(dir, {
        start: "2026-04-02T00:00:00.000Z",
        end: "2026-04-02T23:59:59.999Z",
      });
      expect(out.map((m) => m.meetingId).sort()).toEqual(["b", "c"]);
    });

    it("matches scheduledStartAt when set, not just createdAt", async () => {
      // Created today, scheduled next month — should match a "next month"
      // window even though createdAt is outside it.
      const scheduled = makeFile("sched", "Future", "2026-04-02T08:00:00Z");
      scheduled.scheduledStartAt = "2026-05-15T09:00:00.000Z";
      await writeMeeting(scheduled);
      const out = await listMeetings(dir, {
        start: "2026-05-01T00:00:00Z",
        end: "2026-05-31T23:59:59Z",
      });
      expect(out.map((m) => m.meetingId)).toEqual(["sched"]);
    });

    it("accepts an open-ended range (only start, only end)", async () => {
      const fromMid = await listMeetings(dir, {
        start: "2026-04-02T12:00:00Z",
      });
      expect(fromMid.map((m) => m.meetingId)).toEqual(["d", "c"]);

      const beforeMid = await listMeetings(dir, {
        end: "2026-04-02T12:00:00Z",
      });
      expect(beforeMid.map((m) => m.meetingId)).toEqual(["b", "a"]);
    });

    it("throws on unparseable ISO bounds", async () => {
      await expect(
        listMeetings(dir, { start: "not-a-date" }),
      ).rejects.toThrow(/ISO 8601/);
      await expect(
        listMeetings(dir, { end: "also bogus" }),
      ).rejects.toThrow(/ISO 8601/);
    });
  });

  it("respects filter.limit and applies it after sort", async () => {
    await writeMeeting(makeFile("a", "A", "2026-04-01T10:00:00Z"));
    await writeMeeting(makeFile("b", "B", "2026-04-02T10:00:00Z"));
    await writeMeeting(makeFile("c", "C", "2026-04-03T10:00:00Z"));
    const out = await listMeetings(dir, { limit: 2 });
    expect(out.map((m) => m.meetingId)).toEqual(["c", "b"]);
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

  it("returns full files whose effective time is in [start, end]", async () => {
    const out = await getMeetingsInRange(
      dir,
      "2026-04-02T00:00:00.000Z",
      "2026-04-02T23:59:59.999Z",
    );
    expect(out.map((f) => f.meetingId).sort()).toEqual(["b", "c"]);
  });

  it("treats partial-day bounds correctly via ms compare (not lexicographic)", async () => {
    const out = await getMeetingsInRange(dir, "2026-04-02", "2026-04-02");
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

  it("filters by title only when titleQuery is supplied", async () => {
    // Replace `b` with one whose title would not match but whose notes
    // mention "hiring" — content must NOT make it a hit.
    await rm(join(dir, "b.oats"));
    await writeMeeting(
      withNote(
        makeFile("b", "Roadmap", "2026-04-02T08:00:00.000Z"),
        "p1",
        "talked about hiring",
      ),
    );
    const titleHit = await getMeetingsInRange(
      dir,
      "2026-04-01T00:00:00Z",
      "2026-04-04T00:00:00Z",
      { titleQuery: "roadmap" },
    );
    expect(titleHit.map((f) => f.meetingId)).toEqual(["b"]);

    const contentMiss = await getMeetingsInRange(
      dir,
      "2026-04-01T00:00:00Z",
      "2026-04-04T00:00:00Z",
      { titleQuery: "HIRING" },
    );
    expect(contentMiss).toEqual([]);
  });

  it("respects an optional limit", async () => {
    const out = await getMeetingsInRange(
      dir,
      "2026-04-01T00:00:00Z",
      "2026-04-04T00:00:00Z",
      { limit: 2 },
    );
    // Newest-first slice.
    expect(out.map((f) => f.meetingId)).toEqual(["d", "c"]);
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

describe("isMcpEnabled", () => {
  it("returns true when no config file exists", async () => {
    expect(await isMcpEnabled(dir)).toBe(true);
  });

  it("returns true when the config sets mcpEnabled: true", async () => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ mcpEnabled: true }),
      "utf8",
    );
    expect(await isMcpEnabled(dir)).toBe(true);
  });

  it("returns false when the config sets mcpEnabled: false", async () => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ mcpEnabled: false }),
      "utf8",
    );
    expect(await isMcpEnabled(dir)).toBe(false);
  });

  it("treats malformed config as enabled (fail-open)", async () => {
    await writeFile(join(dir, "config.json"), "{not json", "utf8");
    expect(await isMcpEnabled(dir)).toBe(true);
  });

  it("treats unrelated config keys as enabled", async () => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ other: "value" }),
      "utf8",
    );
    expect(await isMcpEnabled(dir)).toBe(true);
  });
});

describe("scheduleMeeting", () => {
  it("writes a well-formed .oats file with the given title and schedule", async () => {
    const summary = await scheduleMeeting(dir, {
      title: "Quarterly review",
      scheduledStartAt: "2026-06-15T14:00:00.000Z",
      notetaker: "Tom",
    });

    expect(summary.title).toBe("Quarterly review");
    expect(summary.displayName).toBe("Quarterly review");
    expect(summary.scheduledStartAt).toBe("2026-06-15T14:00:00.000Z");
    expect(summary.notetaker).toBe("Tom");
    expect(summary.started).toBe(false);
    expect(summary.meetingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(summary.link).toBe(`oats://meeting/${summary.meetingId}`);

    const onDisk = await getMeeting(dir, summary.meetingId);
    expect(onDisk).not.toBeNull();
    expect(isOatsFile(onDisk)).toBe(true);
    expect(onDisk?.title).toBe("Quarterly review");
    expect(onDisk?.scheduledStartAt).toBe("2026-06-15T14:00:00.000Z");
    expect(onDisk?.events[0]).toMatchObject({
      type: "meeting_started",
      notetaker: "Tom",
    });
    expect(onDisk?.snapshot).toEqual({ ops: [{ insert: "\n" }] });
    expect(onDisk?.paragraphIds).toEqual([]);
  });

  it("trims the title and rejects empty/whitespace-only titles", async () => {
    const summary = await scheduleMeeting(dir, {
      title: "  Roadmap  ",
      scheduledStartAt: "2026-06-15T14:00:00Z",
    });
    expect(summary.title).toBe("Roadmap");

    await expect(
      scheduleMeeting(dir, { title: "", scheduledStartAt: "2026-06-15T14:00:00Z" }),
    ).rejects.toThrow(/title/i);
    await expect(
      scheduleMeeting(dir, {
        title: "   ",
        scheduledStartAt: "2026-06-15T14:00:00Z",
      }),
    ).rejects.toThrow(/title/i);
  });

  it("rejects an unparseable scheduledStartAt", async () => {
    await expect(
      scheduleMeeting(dir, {
        title: "Whatever",
        scheduledStartAt: "next tuesday",
      }),
    ).rejects.toThrow(/ISO 8601/);
  });

  it("normalizes loose ISO inputs to a UTC timestamp", async () => {
    const summary = await scheduleMeeting(dir, {
      title: "Sync",
      scheduledStartAt: "2026-06-15T14:00:00Z",
    });
    // Always full-precision UTC after round-tripping through Date.
    expect(summary.scheduledStartAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("defaults notetaker to empty when omitted", async () => {
    const summary = await scheduleMeeting(dir, {
      title: "TBD owner",
      scheduledStartAt: "2026-06-15T14:00:00Z",
    });
    expect(summary.notetaker).toBe("");
    const onDisk = await getMeeting(dir, summary.meetingId);
    expect(onDisk?.notetaker).toBe("");
    expect(onDisk?.events[0]).toMatchObject({
      type: "meeting_started",
      notetaker: "",
    });
  });

  it("creates the meetings directory if it does not yet exist", async () => {
    const fresh = join(dir, "nested");
    await scheduleMeeting(fresh, {
      title: "Fresh",
      scheduledStartAt: "2026-06-15T14:00:00Z",
    });
    const entries = await readdir(fresh);
    expect(entries.some((n) => n.endsWith(".oats"))).toBe(true);
  });

  it("makes the new meeting visible to listMeetings immediately", async () => {
    const summary = await scheduleMeeting(dir, {
      title: "Visible",
      scheduledStartAt: "2026-06-15T14:00:00Z",
    });
    const out = await listMeetings(dir);
    expect(out.map((m) => m.meetingId)).toContain(summary.meetingId);
  });

  it("produces JSON that round-trips through readFile + isOatsFile", async () => {
    const summary = await scheduleMeeting(dir, {
      title: "Roundtrip",
      scheduledStartAt: "2026-06-15T14:00:00Z",
    });
    const text = await readFile(join(dir, `${summary.meetingId}.oats`), "utf8");
    const parsed: unknown = JSON.parse(text);
    expect(isOatsFile(parsed)).toBe(true);
  });

  it("creates files with distinct ids on repeated calls", async () => {
    const a = await scheduleMeeting(dir, {
      title: "A",
      scheduledStartAt: "2026-06-15T14:00:00Z",
    });
    const b = await scheduleMeeting(dir, {
      title: "B",
      scheduledStartAt: "2026-06-15T15:00:00Z",
    });
    expect(a.meetingId).not.toBe(b.meetingId);
    const out = await listMeetings(dir);
    expect(out.length).toBe(2);
  });
});
