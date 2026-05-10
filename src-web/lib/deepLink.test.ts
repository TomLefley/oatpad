import { describe, it, expect } from "vitest";
import { buildMeetingLink, parseOatsUrl } from "./deepLink";

describe("buildMeetingLink", () => {
  it("formats an `oats://meeting/<id>` URL", () => {
    expect(buildMeetingLink("abc-123")).toBe("oats://meeting/abc-123");
  });
});

describe("parseOatsUrl", () => {
  it("parses the canonical meeting form", () => {
    expect(parseOatsUrl("oats://meeting/abc-123")).toEqual({
      kind: "meeting",
      meetingId: "abc-123",
    });
  });

  it("tolerates a trailing slash", () => {
    expect(parseOatsUrl("oats://meeting/abc-123/")).toEqual({
      kind: "meeting",
      meetingId: "abc-123",
    });
  });

  it("rejects URLs that don't use the oats: scheme", () => {
    expect(parseOatsUrl("https://example.com/meeting/abc-123")).toBeNull();
    expect(parseOatsUrl("not a url")).toBeNull();
    expect(parseOatsUrl("")).toBeNull();
  });

  it("rejects oats: URLs without the meeting/ prefix", () => {
    expect(parseOatsUrl("oats://abc-123")).toBeNull();
    expect(parseOatsUrl("oats://settings")).toBeNull();
    expect(parseOatsUrl("oats://meeting/")).toBeNull();
  });

  it("rejects ids with disallowed characters (path traversal etc.)", () => {
    expect(parseOatsUrl("oats://meeting/../etc/passwd")).toBeNull();
    expect(parseOatsUrl("oats://meeting/abc 123")).toBeNull();
    expect(parseOatsUrl("oats://meeting/abc/extra")).toBeNull();
  });
});
