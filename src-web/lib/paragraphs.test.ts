// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyParagraphIds,
  getBlockElements,
  readNoteIds,
  readParagraphs,
  reconcileNoteIds,
} from "./paragraphs";

function makeIdFactory(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

describe("getBlockElements", () => {
  it("returns top-level element children only, not text nodes", () => {
    root.innerHTML = "stray text<p>one</p>more text<p>two</p>";
    const blocks = getBlockElements(root);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.tagName.toLowerCase()).toBe("p");
    expect(blocks[1]?.tagName.toLowerCase()).toBe("p");
  });
});

describe("reconcileNoteIds", () => {
  it("assigns ids to blocks that have none", () => {
    root.innerHTML = "<p>a</p><p>b</p>";
    reconcileNoteIds(root, makeIdFactory());
    const blocks = getBlockElements(root);
    expect(blocks[0]?.getAttribute("data-note-id")).toBe("id-1");
    expect(blocks[1]?.getAttribute("data-note-id")).toBe("id-2");
  });

  it("preserves existing unique ids", () => {
    root.innerHTML =
      '<p data-note-id="keep-me">a</p><p data-note-id="me-too">b</p>';
    reconcileNoteIds(root, makeIdFactory());
    const blocks = getBlockElements(root);
    expect(blocks[0]?.getAttribute("data-note-id")).toBe("keep-me");
    expect(blocks[1]?.getAttribute("data-note-id")).toBe("me-too");
  });

  it("reassigns duplicate ids on subsequent blocks (split case)", () => {
    // After Quill splits a block, the new sibling can briefly carry the
    // same data-note-id. Reconciliation gives it a fresh id while keeping
    // the first occurrence stable.
    root.innerHTML = '<p data-note-id="x">a</p><p data-note-id="x">b</p>';
    reconcileNoteIds(root, makeIdFactory());
    const blocks = getBlockElements(root);
    expect(blocks[0]?.getAttribute("data-note-id")).toBe("x");
    expect(blocks[1]?.getAttribute("data-note-id")).toBe("id-1");
  });

  it("does not touch the DOM when nothing needs to change", () => {
    root.innerHTML = '<p data-note-id="a">x</p><p data-note-id="b">y</p>';
    let calls = 0;
    reconcileNoteIds(root, () => `made-${++calls}`);
    expect(calls).toBe(0);
  });
});

describe("applyParagraphIds", () => {
  it("writes the supplied ids onto each block in order", () => {
    root.innerHTML = "<p>a</p><p>b</p><p>c</p>";
    applyParagraphIds(root, ["one", "two", "three"]);
    const blocks = getBlockElements(root);
    expect(blocks[0]?.getAttribute("data-note-id")).toBe("one");
    expect(blocks[1]?.getAttribute("data-note-id")).toBe("two");
    expect(blocks[2]?.getAttribute("data-note-id")).toBe("three");
  });

  it("leaves a block alone when the id at that position is missing", () => {
    root.innerHTML =
      '<p data-note-id="prev">a</p><p data-note-id="prev2">b</p>';
    // Only one id supplied; second block should retain its existing one.
    applyParagraphIds(root, ["new-1"]);
    const blocks = getBlockElements(root);
    expect(blocks[0]?.getAttribute("data-note-id")).toBe("new-1");
    expect(blocks[1]?.getAttribute("data-note-id")).toBe("prev2");
  });

  it("ignores extra ids when there are fewer blocks", () => {
    root.innerHTML = "<p>only one</p>";
    expect(() => applyParagraphIds(root, ["a", "b", "c"])).not.toThrow();
    expect(getBlockElements(root)[0]?.getAttribute("data-note-id")).toBe("a");
  });
});

describe("readParagraphs", () => {
  it("returns one paragraph per block with id and trimmed markdown", () => {
    root.innerHTML =
      '<p data-note-id="n1"><strong>bold</strong> body</p>' +
      '<p data-note-id="n2">plain</p>';
    const out = readParagraphs(root);
    expect(out).toHaveLength(2);
    expect(out[0]?.noteId).toBe("n1");
    expect(out[0]?.markdown).toMatch(/\*\*bold\*\* body/);
    expect(out[1]).toEqual({ noteId: "n2", markdown: "plain" });
  });

  it("uses an empty noteId for blocks missing the data attribute", () => {
    root.innerHTML = "<p>orphan</p>";
    const out = readParagraphs(root);
    expect(out[0]?.noteId).toBe("");
  });
});

describe("readNoteIds", () => {
  it("returns one id per block in document order", () => {
    root.innerHTML =
      '<p data-note-id="a">x</p><p data-note-id="b">y</p><p data-note-id="c">z</p>';
    expect(readNoteIds(root)).toEqual(["a", "b", "c"]);
  });

  it("uses an empty string for blocks missing the data attribute", () => {
    root.innerHTML = '<p data-note-id="a">x</p><p>orphan</p>';
    expect(readNoteIds(root)).toEqual(["a", ""]);
  });
});

