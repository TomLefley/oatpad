// Block-element helpers shaped around Quill's bubble-theme DOM:
// "block elements are direct children of root" (i.e. of the editor's
// `.ql-editor`). The functions are unit-testable in isolation but the
// assumption isn't editor-agnostic — any other rich-text editor that
// nests blocks differently would need a different reader.
import type { Paragraph } from "./types";
import { htmlToMarkdown } from "./markdown";
import { assignUniqueIds } from "./noteIds";

const DATA_ATTR = "data-note-id";

export function getBlockElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement,
  );
}

export function reconcileNoteIds(
  root: HTMLElement,
  makeId: () => string,
): void {
  const blocks = getBlockElements(root);
  const current = blocks.map((b) => b.getAttribute(DATA_ATTR));
  const unique = assignUniqueIds(current, makeId);
  for (let i = 0; i < blocks.length; i++) {
    if (current[i] !== unique[i]) {
      blocks[i].setAttribute(DATA_ATTR, unique[i]);
    }
  }
}

export function applyParagraphIds(root: HTMLElement, ids: string[]): void {
  const blocks = getBlockElements(root);
  for (let i = 0; i < blocks.length; i++) {
    const id = ids[i];
    if (id) blocks[i].setAttribute(DATA_ATTR, id);
  }
}

export function readParagraphs(root: HTMLElement): Paragraph[] {
  return getBlockElements(root).map((block) => ({
    noteId: block.getAttribute(DATA_ATTR) ?? "",
    markdown: htmlToMarkdown(block.outerHTML),
  }));
}

// Lightweight read for the snapshot path: only the noteIds, no markdown
// conversion. The snapshot only needs the id ordering — paying the
// DOMPurify + Turndown cost on every keystroke for 50+ paragraphs is
// strictly waste.
export function readNoteIds(root: HTMLElement): string[] {
  return getBlockElements(root).map(
    (block) => block.getAttribute(DATA_ATTR) ?? "",
  );
}

