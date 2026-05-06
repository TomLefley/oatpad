import { describe, it, expect } from "vitest";
import {
  createNoteFlushState,
  seedNoteFlushState,
  onTextChange,
  flushNote,
  flushAll,
  isCrossWord,
  type NoteFlushMap,
  type FlushIO,
} from "./noteFlush";
import { commonPrefixLen, commonSuffixLen } from "./commonAffix";
import type { OatsEvent, Paragraph } from "./types";

const TS = "2026-04-28T12:00:00.000Z";

function makeIO(): FlushIO & { reset: () => void } {
  let n = 0;
  return {
    makeId: () => `evt-${++n}`,
    now: () => TS,
    reset: () => {
      n = 0;
    },
  };
}

function p(noteId: string, markdown: string): Paragraph {
  return { noteId, markdown };
}

// Walks a sequence of paragraph snapshots through onTextChange and
// returns all events produced, end-to-end. Mirrors how the editor
// will drive the state machine on each Quill text-change.
function runScenario(
  steps: Paragraph[][],
  state: NoteFlushMap = createNoteFlushState(),
  io: FlushIO = makeIO(),
): { events: OatsEvent[]; state: NoteFlushMap } {
  const events: OatsEvent[] = [];
  for (const paragraphs of steps) {
    const out = onTextChange(state, paragraphs, io);
    events.push(...out.events);
  }
  return { events, state };
}

function noteUpdates(events: OatsEvent[]): { noteId: string; text: string }[] {
  return events
    .filter((e): e is OatsEvent & { type: "note_updated" } => e.type === "note_updated")
    .map((e) => ({ noteId: e.noteId, text: e.text }));
}

function eventTypes(events: OatsEvent[]): string[] {
  return events.map((e) => e.type);
}

// -- A. isCrossWord predicate ---------------------------------------------

describe("isCrossWord", () => {
  it("returns false for identical empty strings", () => {
    expect(isCrossWord("", "")).toBe(false);
  });

  it("treats empty -> single word as continuous (max < 2)", () => {
    expect(isCrossWord("", "automati")).toBe(false);
  });

  it("treats empty -> multi-word as cross-word", () => {
    expect(isCrossWord("", "hello world")).toBe(true);
  });

  it("treats single word -> empty as continuous", () => {
    expect(isCrossWord("hello", "")).toBe(false);
  });

  it("treats multi-word -> empty as cross-word", () => {
    expect(isCrossWord("hello world", "")).toBe(true);
  });

  it("treats within-word edits as continuous (high overlap)", () => {
    expect(isCrossWord("automati", "automa")).toBe(false);
    expect(isCrossWord("automati", "automagical")).toBe(false);
  });

  it("treats single-word substitution with no overlap as cross-word", () => {
    expect(isCrossWord("hello", "world")).toBe(true);
  });

  it("treats multi-word position substitution as cross-word", () => {
    expect(isCrossWord("magic sauce", "awesome sauce")).toBe(true);
    expect(isCrossWord("this is magic", "this is awesome")).toBe(true);
  });

  it("treats word-count drop as cross-word", () => {
    expect(isCrossWord("this is magic", "this is ")).toBe(true);
  });

  it("treats word-at-position substitution with low overlap as cross-word", () => {
    expect(isCrossWord("this is magic", "this is wizardry")).toBe(true);
  });

  it("ignores trailing whitespace via tokenisation", () => {
    expect(isCrossWord("automati ", "automa")).toBe(false);
  });

  it("treats space removal that joins two words as cross-word", () => {
    expect(isCrossWord("hello there", "hellothere")).toBe(true);
  });

  it("treats a 2-char overlap as within-word", () => {
    expect(isCrossWord("abc", "abd")).toBe(false);
  });

  it("treats a 0-char overlap on short words as cross-word", () => {
    expect(isCrossWord("ab", "cd")).toBe(true);
  });

  it("is case-sensitive but counts trailing-suffix matches as overlap", () => {
    // "hello" vs "Hello": prefix=0 (h vs H), suffix=4 (ello). Overlap 4 ≥ 2 → within-word.
    expect(isCrossWord("hello", "Hello")).toBe(false);
    // "hi" vs "HI": prefix=0, suffix=0. Overlap 0 < 2 → cross-word.
    expect(isCrossWord("hi", "HI")).toBe(true);
  });

  it("treats trailing punctuation as part of the same token", () => {
    // Both tokenise to ["hello."] / ["hello"] — overlap 5 ≥ 2.
    expect(isCrossWord("hello.", "hello")).toBe(false);
  });

  it("treats unicode within-word changes as continuous", () => {
    expect(isCrossWord("café", "cafe")).toBe(false);
    expect(isCrossWord("naïve", "naive")).toBe(false);
  });

  it("treats removing an emoji-bearing word as cross-word", () => {
    expect(isCrossWord("hello 🎉", "hello")).toBe(true);
  });
});

// -- A'. commonPrefixLen / commonSuffixLen --------------------------------

describe("commonPrefixLen / commonSuffixLen", () => {
  it("returns 0 for disjoint strings", () => {
    expect(commonPrefixLen("abc", "xyz")).toBe(0);
    expect(commonSuffixLen("abc", "xyz", 0)).toBe(0);
  });

  it("returns full length for equal strings", () => {
    expect(commonPrefixLen("hello", "hello")).toBe(5);
    expect(commonSuffixLen("hello", "hello", 0)).toBe(5);
  });

  it("does not double-count past the shared prefix", () => {
    // "ab" and "ab" share prefix 2; suffix from-prefix should be 0.
    expect(commonPrefixLen("ab", "ab")).toBe(2);
    expect(commonSuffixLen("ab", "ab", 2)).toBe(0);
  });

  it("computes prefix and suffix for partial overlap", () => {
    expect(commonPrefixLen("automati", "automa")).toBe(6);
    expect(commonSuffixLen("automati", "automa", 6)).toBe(0);
    expect(commonPrefixLen("hello world", "hello there")).toBe(6);
  });
});

// -- B. New-paragraph lifecycle ------------------------------------------

describe("new-paragraph lifecycle is silent", () => {
  it("emits no event when a brand-new paragraph appears", () => {
    const { events, state } = runScenario([[p("a", "")]]);
    expect(events).toEqual([]);
    // The note still gets tracked internally so subsequent edits diff
    // against the right baseline.
    expect(state.has("a")).toBe(true);
  });

  it("emits nothing when an empty paragraph appears and is removed", () => {
    const { events } = runScenario([
      [p("a", "")],
      [], // paragraph removed before any settled state
    ]);
    expect(events).toEqual([]);
  });

  it("emits no events when two paragraphs appear in one step", () => {
    const { events, state } = runScenario([[p("a", ""), p("b", "")]]);
    expect(events).toEqual([]);
    expect(state.has("a") && state.has("b")).toBe(true);
  });

  it("emits nothing for a noteId that keeps getting typed into without settling", () => {
    const { events } = runScenario([
      [p("a", "")],
      [p("a", "h")],
      [p("a", "hi")],
    ]);
    expect(events).toEqual([]);
  });
});

// -- C. Pure addition runs -------------------------------------------------

describe("pure addition runs", () => {
  it("does not emit note_updated mid-addition (no reversal)", () => {
    const { events } = runScenario([
      [p("a", "")],
      [p("a", "h")],
      [p("a", "he")],
      [p("a", "hello")],
    ]);
    expect(noteUpdates(events)).toEqual([]);
  });

  it("emits one note_updated on flushNote for an unbroken addition", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const seq = [[p("a", "")], [p("a", "Mentioned salary several times")]];
    runScenario(seq, state, io);
    const out = flushNote(state, "a", io);
    expect(noteUpdates(out.events)).toEqual([
      { noteId: "a", text: "Mentioned salary several times" },
    ]);
  });

  it("collapses the headline 'Me ... Mentioned salary several times' regression to one event", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", "")],
        [p("a", "M")],
        [p("a", "Me")],
        // (long pause here would have triggered the old idle commit)
        [p("a", "Men")],
        [p("a", "Mentioned salary several times")],
      ],
      state,
      io,
    );
    const flushed = flushAll(state, io);
    const updates = noteUpdates(flushed.events);
    expect(updates).toEqual([
      { noteId: "a", text: "Mentioned salary several times" },
    ]);
  });

  it("treats addition at the beginning as add direction", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", "")],
        [p("a", "world")],
        // Insert "hello " at the front.
        [p("a", "hello world")],
      ],
      state,
      io,
    );
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "hello world" },
    ]);
  });

  it("treats addition in the middle as add direction", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", "")],
        [p("a", "abdef")],
        // Insert "c" between "ab" and "def".
        [p("a", "abcdef")],
      ],
      state,
      io,
    );
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "abcdef" },
    ]);
  });
});

// -- D. Pure deletion runs -------------------------------------------------

describe("pure deletion runs", () => {
  it("does not emit at the within-word reversal of automati -> automa", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", "")],
        [p("a", "automati")],
        [p("a", "automat")],
        [p("a", "automa")],
        [p("a", "automag")], // reversal back to add
      ],
      state,
      io,
    );
    expect(noteUpdates(state.size > 0 ? [] : []).length).toBe(0);
  });

  it("emits at a cross-word del→add reversal that drops a whole word", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "hello world")],
        [p("a", "hello worl")],
        [p("a", "hello wor")],
        [p("a", "hello wo")],
        [p("a", "hello w")],
        [p("a", "hello ")],
        [p("a", "hello t")], // del→add reversal
      ],
      state,
      io,
    );
    // First reversal (add→del when first backspace lands) emits "hello world"
    // (cross-word: "" vs "hello world" → 0/2). Then the del run continues
    // through to "hello ", and the add reversal to "hello t" emits "hello "
    // (cross-word: count drop 2→1 with max≥2 ... wait, max(2,1)=2, ≥2 → cross).
    expect(noteUpdates(events)).toEqual([
      { noteId: "a", text: "hello world" },
      { noteId: "a", text: "hello " },
    ]);
  });

  it("does not emit when the add run only built up a single word and is deleted", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "hello")],
        [p("a", "hell")],
        [p("a", "")],
        [p("a", "h")], // del→add reversal
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([]);
  });

  it("treats a single-char delete from end of word as within-word", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "automatic")],
        [p("a", "automati")], // 1-char del; runStartText=""
        [p("a", "automatic")], // del→add reversal
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([]);
  });
});

// -- E. Direction reversal classifications -------------------------------

describe("direction reversal classifications", () => {
  it("automati → automa → automagical produces exactly one event on flush", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", "")],
        [p("a", "a")],
        [p("a", "au")],
        [p("a", "automati")],
        [p("a", "automat")], // del run begins
        [p("a", "automa")],
        [p("a", "automag")], // add run begins
        [p("a", "automagical")],
      ],
      state,
      io,
    );
    const flushed = flushAll(state, io);
    expect(noteUpdates(flushed.events)).toEqual([
      { noteId: "a", text: "automagical" },
    ]);
  });

  it("typo: helo → hel → hello → 1 emit on flush", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "helo")],
        [p("a", "hel")], // del
        [p("a", "hell")], // add (within-word)
        [p("a", "hello")],
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([]);
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "hello" },
    ]);
  });

  it("over-correction: helloo → hello → hellow stays within-word throughout", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "helloo")],
        [p("a", "hello")], // del run starts
        [p("a", "hellow")], // add run starts
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([]);
  });

  it("multi-word lifecycle: typing → backspacing word → typing more → returning", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", "")],
        [p("a", "I've typed out half")],
        [p("a", "I've typed out hal")], // first del
        [p("a", "I've typed out ha")],
        [p("a", "I've typed out h")],
        [p("a", "I've typed out ")],
        [p("a", "I've typed out s")], // del→add reversal
        [p("a", "I've typed out some of this note")],
      ],
      state,
      io,
    );
    // Two reversals so far: end of add (→ "I've typed out half"), end of del (→ "I've typed out ").
    // No further reversal yet.
    const beforeFlush = flushNote(state, "a", io);
    // flushNote on the in-progress add run should emit "I've typed out some of this note".

    // We didn't capture the events from runScenario above — re-run to grab them.
    const fresh = createNoteFlushState();
    const io2 = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "I've typed out half")],
        [p("a", "I've typed out hal")],
        [p("a", "I've typed out ")],
        [p("a", "I've typed out s")],
        [p("a", "I've typed out some of this note")],
      ],
      fresh,
      io2,
    );
    const final = flushNote(fresh, "a", io2);
    expect(noteUpdates([...events, ...final.events])).toEqual([
      { noteId: "a", text: "I've typed out half" },
      { noteId: "a", text: "I've typed out " },
      { noteId: "a", text: "I've typed out some of this note" },
    ]);
    expect(beforeFlush).toBeDefined();
  });

  it("single-word delete-all then retype is one emit on flush (max<2 at reversal)", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "hello")],
        [p("a", "")], // del run
        [p("a", "w")], // del→add reversal: isCrossWord("hello","")=false
        [p("a", "world")],
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([]);
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "world" },
    ]);
  });

  it("multi-word delete-all then retype: cross-word at reversal and at flush", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "hello world")],
        [p("a", "")], // del run
        [p("a", "g")], // del→add reversal: isCrossWord("hello world","")=true (max=2)
        [p("a", "goodbye friend")],
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([
      { noteId: "a", text: "hello world" },
      { noteId: "a", text: "" },
    ]);
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "goodbye friend" },
    ]);
  });
});

// -- F. Substitutions -----------------------------------------------------

describe("substitutions", () => {
  it("'magic sauce' lifecycle: prior emit + post-flush = 2 events", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", "")],
        [p("a", "This is magic sauce")],
      ],
      state,
      io,
    );
    // Simulate focus loss after typing.
    const e1 = flushNote(state, "a", io);
    expect(noteUpdates(e1.events)).toEqual([
      { noteId: "a", text: "This is magic sauce" },
    ]);

    // Substitution: select "magic" and type "awesome".
    const sub = onTextChange(state, [p("a", "This is awesome sauce")], io);
    expect(noteUpdates(sub.events)).toEqual([]);

    // Final focus loss captures the post-substitution state.
    const e2 = flushNote(state, "a", io);
    expect(noteUpdates(e2.events)).toEqual([
      { noteId: "a", text: "This is awesome sauce" },
    ]);
  });

  it("substitution mid-active-add-run emits pre-sub then post-sub via flush", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "This is magic sauce")],
        // Substitution while still in active add run (no flush).
        [p("a", "This is awesome sauce")],
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([
      { noteId: "a", text: "This is magic sauce" },
    ]);
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "This is awesome sauce" },
    ]);
  });

  it("within-word substitution does not emit at the substitution", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", "")],
        [p("a", "magic")],
      ],
      state,
      io,
    );
    flushNote(state, "a", io); // emit "magic"

    // Substitution: "magic" → "magjc" (typo at position 3). Same length,
    // common prefix 3, common suffix 1. diffOld="i", diffNew="j" → sub.
    const sub = onTextChange(state, [p("a", "magjc")], io);
    expect(noteUpdates(sub.events)).toEqual([]);

    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "magjc" },
    ]);
  });

  it("substitution at start of multi-word text is cross-word", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "hello world")]], state, io);
    flushNote(state, "a", io);

    const sub = onTextChange(state, [p("a", "hi world")], io);
    expect(noteUpdates(sub.events)).toEqual([]); // pre-sub state already emitted
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "hi world" },
    ]);
  });

  it("substitution at end of multi-word text is cross-word", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "hello world")]], state, io);
    flushNote(state, "a", io);

    const sub = onTextChange(state, [p("a", "hello there")], io);
    expect(noteUpdates(sub.events)).toEqual([]);
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "hello there" },
    ]);
  });

  it("equal-length single-word substitution with no overlap is cross-word", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "abc")]], state, io);
    flushNote(state, "a", io);

    const sub = onTextChange(state, [p("a", "xyz")], io);
    expect(noteUpdates(sub.events)).toEqual([]);
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "xyz" },
    ]);
  });

  it("smart-quote substitution mid-active-add-run is silent", () => {
    // macOS / Quill replace ' with ' as the user types past an apostrophe.
    // The change classifies as a sub: prefix runs up to the apostrophe, the
    // apostrophe itself differs. We must NOT emit the pre-sub state here —
    // it would be captured mid-word and pollute the event log.
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "Bit of nervous energy but channeling it well, think it's coi")],
        // Smart-quote conversion replaces the straight apostrophe in "it's"
        // with a curly one, mid-add-run.
        [p("a", "Bit of nervous energy but channeling it well, think it’s coi")],
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([]);
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      {
        noteId: "a",
        text: "Bit of nervous energy but channeling it well, think it’s coi",
      },
    ]);
  });

  it("smart-quote substitution on short word (I'm) is silent", () => {
    // Short word like "I'm" has only 1-char overlap on either side of the
    // apostrophe, which the overlap threshold alone would treat as cross-
    // word. The single-char-diff rule keeps it within-word.
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "and I'm sure")],
        [p("a", "and I’m sure")],
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([]);
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "and I’m sure" },
    ]);
  });

  it("autocorrect-style within-word sub mid-typing does not break the run", () => {
    // User typed "Really good feeling about htis" — autocorrect fires and
    // changes "htis" → "this". The prior add run is cross-word (vs ""), but
    // the sub itself is within-word, so the pre-sub state must NOT emit.
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "Really good feeling about htis")],
        [p("a", "Really good feeling about this")],
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([]);
  });
});

// -- G. Mixed scenarios across multiple notes -----------------------------

describe("multi-note state isolation", () => {
  it("independent runs in two notes do not interfere", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", ""), p("b", "")],
        [p("a", "hello world"), p("b", "automati")],
      ],
      state,
      io,
    );
    // A is multi-word; B is single-word. Reverse direction in both.
    const r = onTextChange(
      state,
      [p("a", "hello"), p("b", "automa")],
      io,
    );
    // A's reversal is cross-word (count drop 2→1, max=2). B's is within-word.
    expect(noteUpdates(r.events)).toEqual([
      { noteId: "a", text: "hello world" },
    ]);
  });

  it("flushAll captures pending state for every note", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", ""), p("b", ""), p("c", "")],
        [p("a", "alpha"), p("b", "beta"), p("c", "gamma")],
      ],
      state,
      io,
    );
    const flushed = flushAll(state, io);
    expect(noteUpdates(flushed.events).sort((x, y) => x.noteId.localeCompare(y.noteId))).toEqual([
      { noteId: "a", text: "alpha" },
      { noteId: "b", text: "beta" },
      { noteId: "c", text: "gamma" },
    ]);
  });

  it("starts tracking each paragraph silently when it appears", () => {
    const { events, state } = runScenario([
      [p("a", "")],
      [p("a", "hello"), p("b", "world")], // Enter splits paragraph; b is new
    ]);
    expect(events).toEqual([]);
    expect(state.has("a") && state.has("b")).toBe(true);
  });
});

// -- H. Selection / focus / flush triggers --------------------------------

describe("flush triggers", () => {
  it("flushNote with no pending change emits nothing", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "hello")]], state, io);
    flushNote(state, "a", io); // first flush: emits "hello"
    const second = flushNote(state, "a", io); // idempotent
    expect(second.events).toEqual([]);
  });

  it("flushNote emits regardless of word-boundary classification", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "automati")]], state, io);
    // No reversal; isCrossWord("", "automati") would be false. flushNote bypasses.
    const out = flushNote(state, "a", io);
    expect(noteUpdates(out.events)).toEqual([
      { noteId: "a", text: "automati" },
    ]);
  });

  it("flushAll twice in a row emits nothing the second time", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario(
      [
        [p("a", ""), p("b", "")],
        [p("a", "alpha"), p("b", "beta")],
      ],
      state,
      io,
    );
    flushAll(state, io);
    expect(flushAll(state, io).events).toEqual([]);
  });

  it("flushAll after a within-word reversal still emits the suppressed final state", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "automati")],
        [p("a", "automa")], // suppressed reversal
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([]);
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "automa" },
    ]);
  });

  it("flushNote on an unknown noteId is a no-op", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    expect(flushNote(state, "ghost", io).events).toEqual([]);
  });
});

// -- I. State reset after flush -------------------------------------------

describe("state reset after flush", () => {
  it("after flushNote, dir is null and runStartText equals lastText", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "hi")]], state, io);
    flushNote(state, "a", io);
    const entry = state.get("a");
    expect(entry?.dir).toBeNull();
    expect(entry?.runStartText).toBe("hi");
  });

  it("a within-word reversal after a flush does not leak old runStartText", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "I've typed out half")]], state, io);
    flushAll(state, io); // emits "I've typed out half"; runStartText now = "I've typed out half"

    // User backspaces to "I've typed out hal" (within-word del). Direction
    // reversal classification should compare against runStartText="I've typed
    // out half", not the pre-flush "".
    const out = onTextChange(
      state,
      [p("a", "I've typed out hal")],
      io,
    );
    expect(noteUpdates(out.events)).toEqual([]);
  });
});

// -- J. Format-only and zero-length changes -------------------------------

describe("format-only and zero-length changes", () => {
  it("identical text emits no events and does not mutate state", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "hello")]], state, io);
    const before = JSON.stringify(state.get("a"));
    const out = onTextChange(state, [p("a", "hello")], io);
    expect(out.events).toEqual([]);
    expect(JSON.stringify(state.get("a"))).toBe(before);
  });
});

// -- K. Paragraph removal mid-edit ----------------------------------------

describe("paragraph removal", () => {
  it("emits note_deleted once a settled state has been emitted", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "hello")]], state, io);
    flushNote(state, "a", io); // settle "hello"
    const out = onTextChange(state, [], io);
    expect(eventTypes(out.events)).toEqual(["note_deleted"]);
    expect(state.has("a")).toBe(false);
  });

  it("removes silently when a paragraph is created and deleted with no settled state", () => {
    const { events } = runScenario([[p("a", "")], []]);
    expect(events).toEqual([]);
  });

  it("emits note_deleted only for paragraphs that had settled emits", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    // Three paragraphs appear; only "a" settles before everything is removed.
    runScenario([[p("a", ""), p("b", ""), p("c", "")]], state, io);
    runScenario([[p("a", "alpha"), p("b", ""), p("c", "")]], state, io);
    flushNote(state, "a", io);
    const out = onTextChange(state, [], io);
    expect(out.events.filter((e) => e.type === "note_deleted").length).toBe(1);
    expect(
      out.events.find((e) => e.type === "note_deleted") as
        | { noteId: string }
        | undefined,
    ).toMatchObject({ noteId: "a" });
  });

  it("removes a note in an active add run silently (no settled state to forget)", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "hello world")]], state, io);
    // Note in active add run, never flushed. Now removed.
    const out = onTextChange(state, [], io);
    expect(out.events).toEqual([]);
    expect(state.has("a")).toBe(false);
  });
});

// -- L. Reload / re-seed --------------------------------------------------

describe("seedNoteFlushState", () => {
  it("seeds lastText and lastEmittedText so a same-text change emits nothing", () => {
    const state = seedNoteFlushState([
      p("a", "hello world"),
      p("b", "automa"),
    ]);
    const io = makeIO();
    const out = onTextChange(
      state,
      [p("a", "hello world"), p("b", "automa")],
      io,
    );
    expect(out.events).toEqual([]);
  });

  it("a one-char addition after seed does not emit until flush", () => {
    const state = seedNoteFlushState([p("a", "hello world")]);
    const io = makeIO();
    const out = onTextChange(state, [p("a", "hello worlds")], io);
    expect(noteUpdates(out.events)).toEqual([]);
    expect(noteUpdates(flushAll(state, io).events)).toEqual([
      { noteId: "a", text: "hello worlds" },
    ]);
  });

  it("flushAll on a freshly-seeded state emits nothing", () => {
    const state = seedNoteFlushState([p("a", "alpha"), p("b", "beta")]);
    const io = makeIO();
    expect(flushAll(state, io).events).toEqual([]);
  });

  it("a within-word reversal after seeded multi-word state does not emit", () => {
    const state = seedNoteFlushState([p("a", "I've typed out half")]);
    const io = makeIO();
    // User backspaces 1 char: del run starts from runStartText="I've typed out half".
    onTextChange(state, [p("a", "I've typed out hal")], io);
    // Then types again — del→add reversal. isCrossWord("I've typed out half", "I've typed out hal")
    // → counts 4 vs 4, position 3 differs ("half" vs "hal", overlap 3 ≥ 2) → within-word.
    const r = onTextChange(state, [p("a", "I've typed out halX")], io);
    expect(noteUpdates(r.events)).toEqual([]);
  });

  it("emits note_deleted for a seeded paragraph that had a prior note_updated", () => {
    const events: OatsEvent[] = [
      {
        type: "note_updated",
        id: "u1",
        ts: TS,
        noteId: "a",
        text: "hello world",
      },
    ];
    const state = seedNoteFlushState([p("a", "hello world")], events);
    const io = makeIO();
    const out = onTextChange(state, [], io);
    expect(eventTypes(out.events)).toEqual(["note_deleted"]);
  });

  it("does NOT emit note_deleted for a seeded paragraph the consumer never saw", () => {
    // Snapshot/paragraphIds got persisted with a paragraph whose
    // note_updated never made it into the events array — e.g. a
    // crash-restart where the snapshot debounce wrote but the
    // beforeunload flush never ran. The consumer reading the events log
    // never heard about this noteId, so a `note_deleted` referring to
    // it is just noise.
    const state = seedNoteFlushState([p("a", "hello world")], []);
    const io = makeIO();
    const out = onTextChange(state, [], io);
    expect(out.events).toEqual([]);
  });

  it("does NOT emit note_deleted for the auto-assigned paragraph of a fresh meeting", () => {
    // Fresh meeting: paragraphIds=[] in the file, so reconcileNoteIds
    // assigns a brand-new id to the empty starter paragraph. There is
    // no events history for that id. Removing the paragraph (e.g. via
    // an editor restructure) must not emit note_deleted.
    const state = seedNoteFlushState([p("fresh-id", "")], []);
    const io = makeIO();
    const out = onTextChange(state, [], io);
    expect(out.events).toEqual([]);
  });
});

// -- M. Whitespace and unusual content ------------------------------------

describe("whitespace handling", () => {
  it("a paragraph emptied to '' from a multi-word state emits at the add→del boundary, then '' on next add", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    runScenario([[p("a", "")], [p("a", "hello world")]], state, io);
    // First del: ends the add run. Cross-word ("" → "hello world", max=2) → emit "hello world".
    const del = onTextChange(state, [p("a", "")], io);
    expect(noteUpdates(del.events)).toEqual([
      { noteId: "a", text: "hello world" },
    ]);
    // Reversal del→add: isCrossWord("hello world", "") → cross-word, emit "".
    const add = onTextChange(state, [p("a", "x")], io);
    expect(noteUpdates(add.events)).toEqual([{ noteId: "a", text: "" }]);
  });

  it("typing a single space inside a single-word note is a within-word add reversal candidate", () => {
    // Build "hello", then add a space (insertion in middle): pure add.
    // Then reversal back to del shouldn't emit (final state still single-word).
    const state = createNoteFlushState();
    const io = makeIO();
    const { events } = runScenario(
      [
        [p("a", "")],
        [p("a", "hello")],
        [p("a", "hel lo")], // pure add: " " inserted at pos 3
        [p("a", "hel l")], // del→ reversal: isCrossWord("","hel lo") → counts 0/2 → cross
      ],
      state,
      io,
    );
    expect(noteUpdates(events)).toEqual([{ noteId: "a", text: "hel lo" }]);
  });

  it("paragraphs with empty noteId are skipped", () => {
    const out = onTextChange(
      createNoteFlushState(),
      [p("", "ghost")],
      makeIO(),
    );
    expect(out.events).toEqual([]);
  });
});

// -- N. Long-running session sanity ---------------------------------------

describe("long-running session", () => {
  it("hundreds of micro-edits produce a bounded number of events", () => {
    const state = createNoteFlushState();
    const io = makeIO();
    const events: OatsEvent[] = [];

    events.push(...onTextChange(state, [p("a", "")], io).events);

    let text = "";
    // 100 chars of single-word typing.
    for (let i = 0; i < 100; i++) {
      text += "x";
      const out = onTextChange(state, [p("a", text)], io);
      events.push(...out.events);
    }
    // Backspace half of it within-word.
    for (let i = 0; i < 50; i++) {
      text = text.slice(0, -1);
      const out = onTextChange(state, [p("a", text)], io);
      events.push(...out.events);
    }
    // Type 50 more chars within-word.
    for (let i = 0; i < 50; i++) {
      text += "y";
      const out = onTextChange(state, [p("a", text)], io);
      events.push(...out.events);
    }

    // Within-word throughout: no events at all until flush.
    expect(events).toEqual([]);

    const flushed = flushAll(state, io);
    expect(noteUpdates(flushed.events).length).toBe(1);
  });
});
