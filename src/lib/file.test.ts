import { describe, it, expect } from "vitest";
import { parseOatsFile } from "./file";

const valid = {
  version: 1,
  meetingId: "m1",
  notetaker: "Tom",
  title: "meeting - x",
  createdAt: "2026-04-23T10:00:00.000Z",
  events: [
    {
      type: "meeting_started",
      id: "e1",
      ts: "2026-04-23T10:00:00.000Z",
      notetaker: "Tom",
    },
    {
      type: "note_created",
      id: "e2",
      ts: "2026-04-23T10:00:01.000Z",
      noteId: "n1",
    },
    {
      type: "note_updated",
      id: "e3",
      ts: "2026-04-23T10:00:02.000Z",
      noteId: "n1",
      text: "hello",
    },
  ],
  snapshot: { ops: [{ insert: "hello\n" }] },
  paragraphIds: ["n1"],
};

function withChange<T extends object>(changes: Partial<T>): string {
  return JSON.stringify({ ...valid, ...changes });
}

describe("parseOatsFile", () => {
  it("accepts a valid file", () => {
    const file = parseOatsFile(JSON.stringify(valid));
    expect(file.notetaker).toBe("Tom");
    expect(file.events).toHaveLength(3);
    expect(file.snapshot.ops[0]).toEqual({ insert: "hello\n" });
  });

  it("rejects non-JSON", () => {
    expect(() => parseOatsFile("not json")).toThrow(/valid JSON/);
  });

  it("rejects non-object top level", () => {
    expect(() => parseOatsFile("42")).toThrow(/not an object/);
  });

  it("rejects unknown version", () => {
    expect(() => parseOatsFile(withChange({ version: 2 }))).toThrow(
      /Unsupported/,
    );
  });

  it("rejects missing meetingId", () => {
    const raw = { ...valid } as Record<string, unknown>;
    delete raw.meetingId;
    expect(() => parseOatsFile(JSON.stringify(raw))).toThrow(/meetingId/);
  });

  it("rejects non-array events", () => {
    expect(() => parseOatsFile(withChange({ events: {} }))).toThrow(
      /events.*array/,
    );
  });

  it("rejects unknown event type", () => {
    expect(() =>
      parseOatsFile(
        withChange({
          events: [{ type: "note_disintegrated", id: "x", ts: "t" }],
        }),
      ),
    ).toThrow(/unknown type/);
  });

  it("rejects legacy note_edited as an unknown type", () => {
    expect(() =>
      parseOatsFile(
        withChange({
          events: [
            {
              type: "note_edited",
              id: "x",
              ts: "t",
              noteId: "n",
              text: "hi",
            },
          ],
        }),
      ),
    ).toThrow(/unknown type/);
  });

  it("rejects note_updated missing noteId", () => {
    expect(() =>
      parseOatsFile(
        withChange({
          events: [{ type: "note_updated", id: "x", ts: "t", text: "hi" }],
        }),
      ),
    ).toThrow(/noteId/);
  });

  it("rejects note_updated missing text", () => {
    expect(() =>
      parseOatsFile(
        withChange({
          events: [{ type: "note_updated", id: "x", ts: "t", noteId: "n" }],
        }),
      ),
    ).toThrow(/text/);
  });

  it("accepts note_created without text (no longer carries content)", () => {
    const file = parseOatsFile(
      withChange({
        events: [{ type: "note_created", id: "x", ts: "t", noteId: "n" }],
      }),
    );
    expect(file.events[0]).toEqual({
      type: "note_created",
      id: "x",
      ts: "t",
      noteId: "n",
    });
  });

  it("does not enforce 'no extra fields' on note_created (legacy text rides along)", () => {
    // The validator only checks required fields exist. A legacy event with
    // extra `text` parses without error — its consumers ignore the field.
    // Documents this so a future strict-mode tightening is intentional.
    const file = parseOatsFile(
      withChange({
        events: [
          { type: "note_created", id: "x", ts: "t", noteId: "n", text: "hi" },
        ],
      }),
    );
    expect((file.events[0] as { text?: unknown }).text).toBe("hi");
  });

  it("rejects snapshot without ops array", () => {
    expect(() =>
      parseOatsFile(withChange({ snapshot: { ops: "not-array" } })),
    ).toThrow(/ops/);
  });

  it("strips javascript: URL from link attribute", () => {
    const file = parseOatsFile(
      withChange({
        snapshot: {
          ops: [
            {
              insert: "click",
              attributes: { link: "javascript:alert(1)" },
            },
          ],
        },
      }),
    );
    expect(file.snapshot.ops[0]).toEqual({ insert: "click" });
  });

  it("preserves safe http link attributes", () => {
    const file = parseOatsFile(
      withChange({
        snapshot: {
          ops: [{ insert: "go", attributes: { link: "https://example.com" } }],
        },
      }),
    );
    expect(file.snapshot.ops[0].attributes).toEqual({
      link: "https://example.com",
    });
  });

  it("keeps other attributes when link is stripped", () => {
    const file = parseOatsFile(
      withChange({
        snapshot: {
          ops: [
            {
              insert: "click",
              attributes: {
                link: "javascript:alert(1)",
                bold: true,
              },
            },
          ],
        },
      }),
    );
    expect(file.snapshot.ops[0].attributes).toEqual({ bold: true });
  });

  it("defaults missing paragraphIds to empty array", () => {
    const raw = { ...valid } as Record<string, unknown>;
    delete raw.paragraphIds;
    const file = parseOatsFile(JSON.stringify(raw));
    expect(file.paragraphIds).toEqual([]);
  });

  it("rejects non-string paragraphIds", () => {
    expect(() =>
      parseOatsFile(withChange({ paragraphIds: ["ok", 42] })),
    ).toThrow(/paragraphIds\[1\]/);
  });
});
