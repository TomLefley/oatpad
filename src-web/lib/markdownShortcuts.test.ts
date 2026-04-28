import { describe, it, expect } from "vitest";
import { matchInline } from "./markdownShortcuts";

describe("matchInline", () => {
  it("matches bold with **", () => {
    const m = matchInline("hello **world**");
    expect(m).toEqual({
      startOffset: 6,
      matchLength: 9,
      content: "world",
      format: "bold",
    });
  });

  it("matches bold with __", () => {
    const m = matchInline("hello __world__");
    expect(m?.format).toBe("bold");
    expect(m?.content).toBe("world");
  });

  it("matches italic with single *", () => {
    const m = matchInline("hello *world*");
    expect(m?.format).toBe("italic");
    expect(m?.content).toBe("world");
  });

  it("matches italic with single _", () => {
    const m = matchInline("hello _world_");
    expect(m?.format).toBe("italic");
    expect(m?.content).toBe("world");
  });

  it("matches strike with ~~", () => {
    const m = matchInline("hello ~~world~~");
    expect(m?.format).toBe("strike");
    expect(m?.content).toBe("world");
  });

  it("matches inline code with backticks", () => {
    const m = matchInline("hello `code`");
    expect(m?.format).toBe("code");
    expect(m?.content).toBe("code");
  });

  it("does not trigger before closing delimiter", () => {
    expect(matchInline("hello *world")).toBeNull();
    expect(matchInline("hello **world")).toBeNull();
    expect(matchInline("hello `code")).toBeNull();
  });

  it("prefers bold over italic when ** is present", () => {
    const m = matchInline("**a**");
    expect(m?.format).toBe("bold");
  });

  it("does not match across newlines", () => {
    expect(matchInline("*one\ntwo*")).toBeNull();
  });

  it("requires non-empty content", () => {
    expect(matchInline("****")).toBeNull();
    expect(matchInline("**")).toBeNull();
    expect(matchInline("``")).toBeNull();
  });

  it("computes correct start offset", () => {
    const text = "abc *xy*";
    const m = matchInline(text);
    expect(m?.startOffset).toBe(4);
    expect(m?.matchLength).toBe(4);
  });
});
