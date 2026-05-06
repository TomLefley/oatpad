<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Quill from "quill";
  import type { OatsEvent, QuillDelta } from "../lib/types";
  import { uuid } from "../lib/ids";
  import {
    reconcileNoteIds,
    applyParagraphIds,
    readParagraphs,
    readNoteIds,
  } from "../lib/quillParagraphs";
  import { matchInline } from "../lib/markdownShortcuts";
  import {
    createNoteFlushState,
    seedNoteFlushState,
    onTextChange,
    flushNote,
    flushAll,
    type NoteFlushMap,
    type FlushIO,
  } from "../lib/noteFlush";
  import * as store from "../lib/store.svelte";
  import MeetingName from "./MeetingName.svelte";

  const SNAPSHOT_DEBOUNCE_MS = 300;
  // `note_updated` emits are deferred per-note: a cross-word boundary in
  // noteFlush arms the timer, any further activity in the same note resets
  // it, and the timer firing emits the *current* lastText. This coalesces
  // bursts of rapid edit-rewrite cycles into a single settled-state event
  // without reintroducing the mid-thought fragmentation that the pre-
  // 36ec193 idle-timer system suffered from — pure-typing notes (no cross-
  // word reversal) never arm the timer, so a thinking pause does not split
  // them. Focus-loss / blur / explicit flush still emit synchronously.
  const IDLE_EMIT_MS = 1500;

  let container: HTMLDivElement | undefined = $state();
  let quill: Quill | null = null;
  let noteFlushState: NoteFlushMap = createNoteFlushState();
  let activeNoteId: string | null = null;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let suppressCommit = false;

  const io: FlushIO = {
    makeId: () => uuid(),
    now: () => new Date().toISOString(),
  };

  function emitImmediate(events: OatsEvent[]): void {
    if (events.length > 0) store.appendEvents(events);
  }

  // Routes events from `onTextChange`. `note_updated` is deferred via the
  // per-note idle buffer; everything else flushes through to the store
  // immediately. `note_deleted` also clears any pending idle timer for
  // that note — the buffered emit would have been stale anyway.
  function emitFromTextChange(events: OatsEvent[]): void {
    const immediate: OatsEvent[] = [];
    for (const e of events) {
      if (e.type === "note_updated") {
        armIdleTimer(e.noteId);
      } else {
        if (e.type === "note_deleted") cancelIdleTimer(e.noteId);
        immediate.push(e);
      }
    }
    emitImmediate(immediate);
  }

  function armIdleTimer(noteId: string): void {
    const existing = idleTimers.get(noteId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      idleTimers.delete(noteId);
      const out = flushNote(noteFlushState, noteId, io);
      emitImmediate(out.events);
    }, IDLE_EMIT_MS);
    idleTimers.set(noteId, t);
  }

  function cancelIdleTimer(noteId: string): void {
    const existing = idleTimers.get(noteId);
    if (!existing) return;
    clearTimeout(existing);
    idleTimers.delete(noteId);
  }

  function cancelAllIdleTimers(): void {
    for (const t of idleTimers.values()) clearTimeout(t);
    idleTimers.clear();
  }

  function persistSnapshot(): void {
    if (!quill) return;
    store.setSnapshot(
      quill.getContents() as unknown as QuillDelta,
      readNoteIds(quill.root),
    );
  }

  function scheduleSnapshot(): void {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      persistSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  // Synchronous flush — emit pending events for every tracked note and
  // write the snapshot. Used externally before save / open / new / switch /
  // delete so the in-memory store is fully up to date.
  export function flush(): void {
    if (!quill) return;
    if (snapshotTimer) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }
    cancelAllIdleTimers();
    if (suppressCommit) return;
    const out = flushAll(noteFlushState, io);
    emitImmediate(out.events);
    persistSnapshot();
  }

  export function reload(): void {
    if (!quill) return;
    suppressCommit = true;
    if (snapshotTimer) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }
    cancelAllIdleTimers();
    const meeting = store.state.meeting;
    if (meeting) {
      quill.setContents(meeting.snapshot as unknown as never);
      applyParagraphIds(quill.root, meeting.paragraphIds);
    } else {
      quill.setContents({ ops: [{ insert: "\n" }] } as unknown as never);
    }
    reconcileNoteIds(quill.root, uuid);
    noteFlushState = seedNoteFlushState(
      readParagraphs(quill.root),
      meeting?.events ?? [],
    );
    activeNoteId = null;
    suppressCommit = false;
    clearStaleEditorSelection();
  }

  // setContents leaves a native selection inside .ql-editor. If focus
  // isn't on the editor (e.g. boot, or a meeting switch driven by a
  // sidebar-row click), macOS WKWebView paints a faded "inactive caret"
  // at the top-left of the editor that lingers until the next focus
  // change — and reappears as a greyed-out twin caret the moment the
  // user clicks anywhere else in the editor area. Drop the selection so
  // there's no caret until something is actually focused.
  function clearStaleEditorSelection(): void {
    if (!quill) return;
    if (document.activeElement === quill.root) return;
    const nativeSel = window.getSelection();
    if (nativeSel && quill.root.contains(nativeSel.anchorNode)) {
      nativeSel.removeAllRanges();
    }
  }

  function getLineDomNode(line: unknown): HTMLElement | null {
    if (!line || typeof line !== "object" || !("domNode" in line)) return null;
    const dn = (line as { domNode: unknown }).domNode;
    return dn instanceof HTMLElement ? dn : null;
  }

  function currentNoteId(): string | null {
    if (!quill) return null;
    const sel = quill.getSelection();
    if (!sel) return null;
    const [line] = quill.getLine(sel.index);
    const domNode = getLineDomNode(line);
    if (!domNode) return null;
    return domNode.getAttribute("data-note-id");
  }

  function flushActiveNote(): void {
    if (!activeNoteId) return;
    cancelIdleTimer(activeNoteId);
    const out = flushNote(noteFlushState, activeNoteId, io);
    emitImmediate(out.events);
  }

  function handleTextChange(
    _delta: unknown,
    _oldDelta: unknown,
    source: string,
  ): void {
    if (suppressCommit) return;
    if (source === "user") {
      store.noteInput();
      applyInlineMarkdown();
    }
    if (!quill) return;
    reconcileNoteIds(quill.root, uuid);
    const paragraphs = readParagraphs(quill.root);
    // Snapshot lastText per note before onTextChange mutates it. After
    // the call, any note whose lastText differs from its prior value had
    // a text change in this tick — within-word edits show up here even
    // when no note_updated event was returned.
    const priorLastText = new Map<string, string>();
    for (const [id, entry] of noteFlushState) {
      priorLastText.set(id, entry.lastText);
    }
    const out = onTextChange(noteFlushState, paragraphs, io);
    emitFromTextChange(out.events);
    // Within-word activity in a note that already has a buffered emit
    // (timer armed) keeps the timer alive — the user is still editing,
    // so the state is not yet settled.
    for (const p of paragraphs) {
      if (!idleTimers.has(p.noteId)) continue;
      if (priorLastText.get(p.noteId) !== p.markdown) {
        armIdleTimer(p.noteId);
      }
    }
    scheduleSnapshot();
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
    if (!range) {
      // Editor lost focus via Quill's own tracking — leave the active-note
      // bookkeeping to handleBlur which fires on the DOM blur event so the
      // ordering is consistent.
      return;
    }
    const noteId = currentNoteId();
    if (noteId !== activeNoteId) {
      flushActiveNote();
      activeNoteId = noteId;
    }
  }

  function handleBlur(): void {
    flush();
    activeNoteId = null;
  }

  // Returns true if it found a toolbar to decorate. The bubble theme
  // mounts the toolbar inside `.ql-tooltip` synchronously during
  // `new Quill()`, but a defensive retry on first selection-change
  // means we still cover any future Quill change that delays the
  // tooltip until first use. Idempotent — safe to call repeatedly.
  function addToolbarTooltips(root: HTMLElement): boolean {
    const toolbar = root.querySelector(".ql-toolbar, .ql-tooltip");
    if (!toolbar) return false;
    if (!toolbar.querySelector(".ql-bold, .ql-italic, .ql-header")) return false;
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
    return true;
  }

  function isMac(): boolean {
    type NavigatorWithUAData = Navigator & {
      userAgentData?: { platform?: string };
    };
    const nav = navigator as NavigatorWithUAData;
    const platform = nav.userAgentData?.platform || navigator.platform || "";
    return /Mac|iPhone|iPad/.test(platform);
  }

  onMount(() => {
    if (!container) return;
    quill = new Quill(container, {
      theme: "bubble",
      placeholder: "Start typing notes…",
      // Constrain the bubble tooltip to the editor's own box so it can't
      // overflow leftward into the sidebar's column when text near the
      // left edge is selected.
      bounds: container,
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
    let tooltipsAttached = addToolbarTooltips(container);

    reload();

    quill.on("text-change", handleTextChange);
    quill.on("selection-change", (range) => {
      // The bubble theme has the toolbar in the DOM from construction, but
      // belt-and-braces: if we missed it on mount (e.g. a future Quill
      // version delays the build), pick it up now that the user has made a
      // selection — the tooltip is guaranteed to exist by then.
      if (!tooltipsAttached && container) {
        tooltipsAttached = addToolbarTooltips(container);
      }
      handleSelectionChange(range);
    });
    quill.root.addEventListener("blur", handleBlur);
    store.registerEditorFlush(flush);
  });

  onDestroy(() => {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    cancelAllIdleTimers();
    store.unregisterEditorFlush(flush);
    if (quill) {
      quill.root.removeEventListener("blur", handleBlur);
    }
  });
</script>

<div class="editor-wrap">
  <MeetingName />
  <div bind:this={container} class="editor"></div>
</div>

<style>
  .editor-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--surface);
  }
  .editor {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  :global(.ql-container.ql-bubble) {
    font-size: 16px;
  }
  :global(.ql-editor) {
    min-height: 300px;
    padding: 16px 32px 24px;
  }
</style>
