import { describe, it, expect } from "vitest";
import { parseOatsFile } from "./file";

const valid = {
  version: 1,
  sessionId: "s1",
  notetaker: "Tom",
  title: "meeting - x",
  createdAt: "2026-04-23T10:00:00.000Z",
  events: [
    {
      type: "session_started",
      id: "e1",
      ts: "2026-04-23T10:00:00.000Z",
      notetaker: "Tom",
    },
    {
      type: "note_created",
      id: "e2",
      ts: "2026-04-23T10:00:01.000Z",
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
    expect(file.events).toHaveLength(2);
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

  it("rejects missing sessionId", () => {
    const raw = { ...valid } as Record<string, unknown>;
    delete raw.sessionId;
    expect(() => parseOatsFile(JSON.stringify(raw))).toThrow(/sessionId/);
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

  it("rejects note_edited missing noteId", () => {
    expect(() =>
      parseOatsFile(
        withChange({
          events: [{ type: "note_edited", id: "x", ts: "t", text: "hi" }],
        }),
      ),
    ).toThrow(/noteId/);
  });

  it("rejects note_created missing text", () => {
    expect(() =>
      parseOatsFile(
        withChange({
          events: [{ type: "note_created", id: "x", ts: "t", noteId: "n" }],
        }),
      ),
    ).toThrow(/text/);
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
