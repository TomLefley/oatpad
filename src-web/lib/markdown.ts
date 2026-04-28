import TurndownService from "turndown";
import DOMPurify from "dompurify";

const td = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
});

export function htmlToMarkdown(html: string): string {
  const clean = DOMPurify.sanitize(html);
  return td.turndown(clean).trim();
}
