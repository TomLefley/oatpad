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

// Builds the seed map used by commit diffs after a load or initial mount.
// Whitespace-only paragraphs are skipped so a first keystroke in an empty
// block fires note_created rather than note_edited.
export function seedFromDom(root: HTMLElement): Map<string, string> {
  const state = new Map<string, string>();
  for (const block of getBlockElements(root)) {
    const id = block.getAttribute(DATA_ATTR);
    if (!id) continue;
    const md = htmlToMarkdown(block.outerHTML);
    if (md.trim() === "") continue;
    state.set(id, md);
  }
  return state;
}
