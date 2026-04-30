import type { OatsEvent, Paragraph } from "./types";
import { commonPrefixLen, commonSuffixLen } from "./commonAffix";

/*
 * Per-note flush state machine — decides when typing produces a `note_*`
 * event and which text gets captured.
 *
 * # Model
 * Each tracked note carries a small state object (NoteFlushState). On every
 * `text-change` we diff lastText vs newText, classify the change as add /
 * del / substitution, and update the state:
 *
 *   - add / del same direction        → continue the current "run".
 *   - add / del flips direction       → end the run; emit if cross-word.
 *   - substitution                    → end any open run, then emit if the
 *                                       substitution itself is cross-word.
 *
 * Cross-word changes are the only ones that emit *during* typing. Within-
 * word edits (typo corrections) sit silently inside the current run; the
 * settled state is captured later by `flushNote` (selection-change leaving
 * the note, blur) or `flushAll` (component flush). Focus-loss flushes
 * always emit if state has changed — the cross-word predicate is bypassed
 * because stepping away from the note is itself a meaningful boundary.
 *
 * # Public API
 *   - `createNoteFlushState`   — fresh empty Map for a new meeting.
 *   - `seedNoteFlushState`     — re-seed from a loaded snapshot so the
 *                                first text-change doesn't fire a spurious
 *                                emit comparing against `runStartText=""`.
 *   - `onTextChange`           — drive the state machine for one Quill
 *                                text-change. Emits note_created/updated/
 *                                deleted as appropriate.
 *   - `flushNote` / `flushAll` — focus-loss / explicit flush. Idempotent.
 *   - `isCrossWord`            — pure predicate; exposed so tests and any
 *                                future caller (e.g. an MCP heuristic
 *                                tuner) can reach it directly.
 *
 * # Tweaking the heuristic
 * The thresholds and predicate are intentionally easy to find:
 *   - `OVERLAP_THRESHOLD`      — minimum char overlap (prefix or suffix)
 *                                for two same-position words to count as
 *                                "edited" rather than "replaced".
 *   - `MIN_WORDS_FOR_CROSS`    — when word counts differ, the larger side
 *                                must have at least this many words for
 *                                the change to count as cross-word. Set
 *                                to 2 so empty↔single-word transitions
 *                                are treated as continuous editing.
 *   - `tokenize`               — how text is split into words. Currently
 *                                whitespace-only; a future change could
 *                                strip trailing punctuation, etc.
 *   - `isCrossWord`            — the predicate itself; replace wholesale
 *                                if the rule needs to change.
 *
 * Adding a new event type or a new piece of per-event metadata only
 * touches this file and `types.ts` — `Editor.svelte` and `store.svelte.ts`
 * pass events through opaquely.
 */

// Two same-position words count as a within-word edit when they share at
// least this many chars in common prefix or suffix. Below this, the words
// are treated as a substitution → cross-word.
const OVERLAP_THRESHOLD = 2;

// When word counts differ, the larger side must have at least this many
// words for the change to count as cross-word. (Empty ↔ single-word is
// continuous editing, not a boundary cross.)
const MIN_WORDS_FOR_CROSS = 2;

export type NoteFlushState = {
  runStartText: string;
  lastText: string;
  dir: "add" | "del" | null;
  lastEmittedText: string;
};

export type NoteFlushMap = Map<string, NoteFlushState>;

export type FlushIO = {
  makeId: () => string;
  now: () => string;
};

export function createNoteFlushState(): NoteFlushMap {
  return new Map();
}

// Seeds the flush state from a freshly-loaded snapshot so the first
// text-change does not emit spurious events comparing against an empty
// runStartText.
export function seedNoteFlushState(paragraphs: Paragraph[]): NoteFlushMap {
  const state = createNoteFlushState();
  for (const p of paragraphs) {
    state.set(p.noteId, {
      runStartText: p.markdown,
      lastText: p.markdown,
      dir: null,
      lastEmittedText: p.markdown,
    });
  }
  return state;
}

export function onTextChange(
  state: NoteFlushMap,
  paragraphs: Paragraph[],
  io: FlushIO,
): { events: OatsEvent[] } {
  const events: OatsEvent[] = [];
  const seenIds = new Set<string>();

  for (const p of paragraphs) {
    if (!p.noteId) continue;
    seenIds.add(p.noteId);

    let entry = state.get(p.noteId);
    if (!entry) {
      events.push(noteCreatedEvent(p.noteId, io));
      entry = freshEntry();
      state.set(p.noteId, entry);
    }

    const newText = p.markdown;
    if (newText === entry.lastText) continue;

    const change = classifyChange(entry.lastText, newText);

    if (change === "sub") {
      // Only break the current run if the substitution itself crosses a
      // word boundary. Within-word subs (typo corrections, smart-quote
      // conversions like ' → ') get absorbed silently into the run so they
      // don't surface as mid-word checkpoints in the event log.
      if (isCrossWord(entry.lastText, newText)) {
        emitLastText(events, entry, p.noteId, io);
        entry.runStartText = newText;
        entry.dir = null;
      }
      entry.lastText = newText;
      continue;
    }

    if (entry.dir === null || entry.dir === change) {
      if (entry.dir === null) entry.runStartText = entry.lastText;
      entry.dir = change;
      entry.lastText = newText;
    } else {
      // Direction reversed — end the just-finished run.
      if (isCrossWord(entry.runStartText, entry.lastText)) {
        emitLastText(events, entry, p.noteId, io);
      }
      entry.runStartText = entry.lastText;
      entry.dir = change;
      entry.lastText = newText;
    }
  }

  for (const noteId of Array.from(state.keys())) {
    if (!seenIds.has(noteId)) {
      events.push({
        type: "note_deleted",
        id: io.makeId(),
        ts: io.now(),
        noteId,
      });
      state.delete(noteId);
    }
  }

  return { events };
}

// Captures the current text of a single note as a settled checkpoint.
// Used on focus loss (selection-change leaving the note, blur), where
// stepping away from the note is itself a meaningful boundary regardless
// of word-level classification. Idempotent.
export function flushNote(
  state: NoteFlushMap,
  noteId: string,
  io: FlushIO,
): { events: OatsEvent[] } {
  const events: OatsEvent[] = [];
  const entry = state.get(noteId);
  if (!entry) return { events };
  emitLastText(events, entry, noteId, io);
  entry.runStartText = entry.lastText;
  entry.dir = null;
  return { events };
}

export function flushAll(
  state: NoteFlushMap,
  io: FlushIO,
): { events: OatsEvent[] } {
  const events: OatsEvent[] = [];
  for (const noteId of Array.from(state.keys())) {
    const out = flushNote(state, noteId, io);
    events.push(...out.events);
  }
  return { events };
}

// Whether a transition between two text states crosses a word boundary —
// the predicate used to suppress within-word edits (typo corrections) while
// surfacing complete-word additions, deletions, and substitutions.
//
// See `OVERLAP_THRESHOLD` and `MIN_WORDS_FOR_CROSS` for the tunable knobs.
export function isCrossWord(oldText: string, newText: string): boolean {
  const oldWords = tokenize(oldText);
  const newWords = tokenize(newText);

  if (oldWords.length !== newWords.length) {
    return Math.max(oldWords.length, newWords.length) >= MIN_WORDS_FOR_CROSS;
  }
  for (let i = 0; i < oldWords.length; i++) {
    if (oldWords[i] === newWords[i]) continue;
    const prefix = commonPrefixLen(oldWords[i], newWords[i]);
    const suffix = commonSuffixLen(oldWords[i], newWords[i], prefix);
    // A 1-for-1 char swap inside a word — e.g. "I'm" → "I'm" via smart
    // quotes, or "abc" → "axc" via a typo — is always within-word, even on
    // short words where the overlap-based threshold below would call it
    // cross-word.
    const oldDiff = oldWords[i].length - prefix - suffix;
    const newDiff = newWords[i].length - prefix - suffix;
    if (oldDiff <= 1 && newDiff <= 1) continue;
    if (Math.max(prefix, suffix) < OVERLAP_THRESHOLD) return true;
  }
  return false;
}

// --- internals -----------------------------------------------------------

function freshEntry(): NoteFlushState {
  return { runStartText: "", lastText: "", dir: null, lastEmittedText: "" };
}

function noteCreatedEvent(noteId: string, io: FlushIO): OatsEvent {
  return { type: "note_created", id: io.makeId(), ts: io.now(), noteId };
}

function classifyChange(oldText: string, newText: string): "add" | "del" | "sub" {
  const P = commonPrefixLen(oldText, newText);
  const S = commonSuffixLen(oldText, newText, P);
  const diffOld = oldText.slice(P, oldText.length - S);
  const diffNew = newText.slice(P, newText.length - S);
  if (diffOld === "" && diffNew !== "") return "add";
  if (diffNew === "" && diffOld !== "") return "del";
  return "sub";
}

// Emits a `note_updated` carrying entry.lastText, but only if that exact
// text hasn't already been emitted for this note. The callers decide
// *whether* to emit (by checking the cross-word predicate); this helper
// just handles the dedupe + bookkeeping.
function emitLastText(
  events: OatsEvent[],
  entry: NoteFlushState,
  noteId: string,
  io: FlushIO,
): void {
  if (entry.lastText === entry.lastEmittedText) return;
  events.push({
    type: "note_updated",
    id: io.makeId(),
    ts: io.now(),
    noteId,
    text: entry.lastText,
  });
  entry.lastEmittedText = entry.lastText;
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((w) => w !== "");
}
