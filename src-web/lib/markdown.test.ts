// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "./markdown";

describe("htmlToMarkdown", () => {
  it("converts plain text untouched", () => {
    expect(htmlToMarkdown("<p>hello world</p>")).toBe("hello world");
  });

  it("emits ATX heading prefixes", () => {
    expect(htmlToMarkdown("<h1>One</h1>")).toBe("# One");
    expect(htmlToMarkdown("<h2>Two</h2>")).toBe("## Two");
    expect(htmlToMarkdown("<h3>Three</h3>")).toBe("### Three");
  });

  it("preserves bold and italic with the configured delimiters", () => {
    expect(htmlToMarkdown("<p><strong>bold</strong></p>")).toBe("**bold**");
    expect(htmlToMarkdown("<p><em>italic</em></p>")).toBe("_italic_");
  });

  it("preserves inline code", () => {
    expect(htmlToMarkdown("<p>run <code>npm test</code></p>")).toBe(
      "run `npm test`",
    );
  });

  it("emits unordered lists with - markers", () => {
    const html = "<ul><li>one</li><li>two</li></ul>";
    expect(htmlToMarkdown(html)).toBe("-   one\n-   two");
  });

  it("emits ordered lists with numeric markers", () => {
    const html = "<ol><li>first</li><li>second</li></ol>";
    expect(htmlToMarkdown(html)).toBe("1.  first\n2.  second");
  });

  it("emits nested lists with indentation", () => {
    const html =
      "<ul><li>outer<ul><li>inner</li></ul></li></ul>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("outer");
    expect(md).toContain("inner");
    // Nested item is indented relative to outer.
    expect(md.split("\n").some((line) => /^\s+-\s+inner/.test(line))).toBe(
      true,
    );
  });

  it("converts links to inline form", () => {
    const html = '<p>see <a href="https://example.com">here</a></p>';
    expect(htmlToMarkdown(html)).toBe("see [here](https://example.com)");
  });

  it("strips javascript: links via DOMPurify before Turndown sees them", () => {
    const html = '<p>click <a href="javascript:alert(1)">me</a></p>';
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("javascript:");
    // Bare anchor with no href becomes a plain text in Turndown's output.
    expect(md).toContain("me");
  });

  it("uses fenced code blocks for <pre><code>", () => {
    const html = "<pre><code>const x = 1;</code></pre>";
    const md = htmlToMarkdown(html);
    expect(md).toMatch(/^```/);
    expect(md).toContain("const x = 1;");
    expect(md).toMatch(/```$/);
  });

  it("trims leading/trailing whitespace", () => {
    expect(htmlToMarkdown("<p>  spaced  </p>")).toBe("spaced");
  });
});
