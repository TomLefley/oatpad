<script lang="ts" module>
  export const IDLE_MS = 3000;
</script>

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Quill from "quill";
  import type { QuillDelta } from "../lib/types";
  import { uuid } from "../lib/ids";
  import {
    reconcileNoteIds,
    applyParagraphIds,
    readParagraphs,
    seedFromDom,
  } from "../lib/paragraphs";
  import { matchInline } from "../lib/markdownShortcuts";
  import { computeCommit } from "../lib/commit";
  import * as store from "../lib/store.svelte";

  let container: HTMLDivElement | undefined = $state();
  let quill: Quill | null = null;
  let committedState = new Map<string, string>();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastBlockIndex: number | null = null;
  let suppressCommit = false;

  export function flush(): void {
    if (!quill) return;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (suppressCommit) return;

    reconcileNoteIds(quill.root, uuid);
    const paragraphs = readParagraphs(quill.root);
    const ts = new Date().toISOString();
    const { events, nextState } = computeCommit({
      previous: committedState,
      current: paragraphs,
      timestamp: ts,
      makeId: uuid,
    });
    committedState = nextState;
    if (events.length > 0) {
      store.appendEvents(events);
    }
    store.setSnapshot(
      quill.getContents() as unknown as QuillDelta,
      paragraphs.map((p) => p.noteId),
    );
  }

  export function reload(): void {
    if (!quill) return;
    suppressCommit = true;
    const session = store.state.session;
    if (session) {
      quill.setContents(session.snapshot as unknown as never);
      applyParagraphIds(quill.root, session.paragraphIds);
    } else {
      quill.setContents({ ops: [{ insert: "\n" }] } as unknown as never);
    }
    reconcileNoteIds(quill.root, uuid);
    committedState = seedFromDom(quill.root);
    suppressCommit = false;
  }

  function getLineDomNode(line: unknown): HTMLElement | null {
    if (!line || typeof line !== "object" || !("domNode" in line)) return null;
    const dn = (line as { domNode: unknown }).domNode;
    return dn instanceof HTMLElement ? dn : null;
  }

  function currentBlockIndex(): number | null {
    if (!quill) return null;
    const sel = quill.getSelection();
    if (!sel) return null;
    const [line] = quill.getLine(sel.index);
    const domNode = getLineDomNode(line);
    if (!domNode) return null;
    return Array.from(quill.root.children).indexOf(domNode);
  }

  function handleTextChange(
    _delta: unknown,
    _oldDelta: unknown,
    source: string,
  ): void {
    if (suppressCommit) return;
    if (source === "user") applyInlineMarkdown();
    if (quill) reconcileNoteIds(quill.root, uuid);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(flush, IDLE_MS);
  }

  function applyInlineMarkdown(): void {
    if (!quill) return;
    const sel = quill.getSelection();
    if (!sel || sel.length !== 0) return;
    const [line, offsetInLine] = quill.getLine(sel.index);
    if (!line) return;
    const lookback = Math.min(offsetInLine, 80);
    const text = quill.getText(sel.index - lookback, lookback);
    const match = matchInline(text);
    if (!match) return;
    const startInDoc = sel.index - (text.length - match.startOffset);
    suppressCommit = true;
    try {
      quill.deleteText(startInDoc, match.matchLength, "silent");
      quill.insertText(
        startInDoc,
        match.content,
        { [match.format]: true },
        "silent",
      );
      quill.setSelection(startInDoc + match.content.length, 0, "silent");
      // Clear the active format so subsequent keystrokes aren't also formatted.
      quill.format(match.format, false, "silent");
    } finally {
      suppressCommit = false;
    }
  }

  function handleSelectionChange(
    range: { index: number; length: number } | null,
  ): void {
    if (!range) return;
    const idx = currentBlockIndex();
    if (idx === null) return;
    if (lastBlockIndex !== null && idx !== lastBlockIndex) {
      flush();
    }
    lastBlockIndex = idx;
  }

  function handleBlur(): void {
    flush();
  }

  function addToolbarTooltips(root: HTMLElement): void {
    const toolbar = root.parentElement?.querySelector(
      ".ql-toolbar, .ql-tooltip.ql-toolbar, .ql-bubble .ql-tooltip",
    );
    if (!toolbar) return;
    const mod = isMac() ? "⌘" : "Ctrl";
    const titles: Record<string, string> = {
      ".ql-bold": `Bold (${mod}+B)`,
      ".ql-italic": `Italic (${mod}+I)`,
      ".ql-underline": `Underline (${mod}+U)`,
      ".ql-strike": "Strikethrough",
      ".ql-clean": "Clear formatting",
      '.ql-list[value="ordered"]': "Numbered list",
      '.ql-list[value="bullet"]': "Bullet list",
      ".ql-header.ql-picker": "Heading",
    };
    for (const [sel, title] of Object.entries(titles)) {
      toolbar.querySelectorAll(sel).forEach((el) => {
        (el as HTMLElement).title = title;
      });
    }
    const headerItems =
      toolbar.querySelectorAll<HTMLElement>(".ql-header .ql-picker-item");
    headerItems.forEach((item) => {
      const v = item.getAttribute("data-value");
      item.title = v ? `Heading ${v}` : "Normal text";
    });
  }

  function isMac(): boolean {
    return /Mac|iPhone|iPad/.test(navigator.platform);
  }

  onMount(() => {
    if (!container) return;
    quill = new Quill(container, {
      theme: "bubble",
      placeholder: "Start typing notes…",
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          ["clean"],
        ],
      },
    });

    quill.root.setAttribute("aria-label", "Meeting notes");
    addToolbarTooltips(container);

    reload();

    quill.on("text-change", handleTextChange);
    quill.on("selection-change", handleSelectionChange);
    quill.root.addEventListener("blur", handleBlur);
  });

  onDestroy(() => {
    if (idleTimer) clearTimeout(idleTimer);
    if (quill) {
      quill.root.removeEventListener("blur", handleBlur);
    }
  });
</script>

<div class="editor-wrap">
  <div bind:this={container} class="editor"></div>
</div>

<style>
  .editor-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .editor {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--surface);
  }
  :global(.ql-container.ql-bubble) {
    font-size: 16px;
  }
  :global(.ql-editor) {
    min-height: 300px;
    padding: 24px 32px;
  }
</style>
