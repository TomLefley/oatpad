# Oatpad — Code Review (remaining items)

Original snapshot taken on `main` at `fbf4a21`. The §1 correctness fixes
have been applied on top of that commit. The two refactor-shaped items
(§2.1 sidebar split, §2.8 shared schema) have moved to
`PLAN_SIDEBAR_SPLIT.md` and `PLAN_SHARED_SCHEMA.md`. Everything below is
the residue: §1.6 (still pending), the smaller coupling/duplication
items, the test-coverage gaps, and the nits. Numbering is preserved
from the original review so cross-references in commits and PRs stay
valid; gaps are intentional.

---

## 1. Bugs and correctness issues

### 1.6 SPEC.md requirement #4 is not satisfied
SPEC says (`SPEC.md:60-64`) the notes output must reference the *recording*
the meeting was captured against, with the identifier coming from the
recording itself. The current schema only carries a locally-generated
`meetingId` UUID — there's no link to any recording. Reading SPEC alone, this
looks deferred ("we'll do this later") but it isn't called out anywhere.
Worth either implementing or amending SPEC.md so the gap is explicit.

---

## 2. Encapsulation, coupling, duplication

### 2.2 Settings.svelte mixes four feature areas
`Settings.svelte` (521 LoC) handles theme, paragraph gap, MCP install/toggle,
and version/updater. The MCP and updater sections are independent state
machines (loading, busy, error, success) coded inline with subtly different
patterns. Extracting `<UpdaterRow />` and `<McpRow />` would shrink the file
by half and let each feature area test its own flow.

### 2.3 Header geometry is coupled to sidebar geometry by magic numbers
`App.svelte:57-59` documents the constraint:

> The icon tray needs to clear the macOS traffic lights on its left
> (92px of left-col padding) and fit four 32px icon slots ...

`Header.svelte` and `Sidebar.svelte` both encode this geometry independently
(the `.search-arrow { right: 82px }` calculation in `Sidebar.svelte:614-624`
is a chain of magic numbers cited by hand). If padding changes anywhere, all
three files need surgery and there's no guard. A shared
`layout.ts` that exports the constants used by all three would let CSS
custom properties carry the values instead of hand-derived offsets in
comments.

### 2.4 `MeetingName` and `OatpadTitle` reimplement the same input pattern
Both components implement the same "draft state tracks store, commit on
blur, Enter blurs, Escape resets" flow:
- `OatpadTitle.svelte:8-35`
- `MeetingName.svelte:4-33`

About 25 lines of duplicated logic, same behaviour, with cosmetic differences
(placeholder text, focus-target wiring). A shared `<EditableLabel />`
component or `useEditableField()` helper would fold them.

### 2.6 `store.svelte.ts` is the only place where platform branching is shrugged off
`platform.ts` (`src-web/lib/platform.ts:1-11`) explicitly states the rule:

> Convention for platform-divergent behaviour: keep the branch *inside the
> feature's own module*

`store.svelte.ts` follows it (`isNative` branches inside `persist`,
`initMeeting`, etc.) — but at the cost of mixing two persistence paths
into one ~380-line file. Splitting `store-native.svelte.ts` and
`store-web.svelte.ts` behind a shared `Store` interface, picked at module
load by platform, would make the divergent code paths testable in isolation
and shrink the file by half. (The current tests already use `vi.mock` on
`./platform` to do this — the structure exists, the abstraction doesn't yet.)

---

## 3. Test coverage

### 3.1 What's well-tested
- `noteFlush.ts` — 1034 lines of tests covering every direction transition,
  smart-quote substitution, autocorrect, paragraph removal, and seeding.
  This is the highest-value module and the test suite reflects that.
- `parseOatsFile`, `replay`, `editBounds`, `phaseFor`, `filterMeetings`,
  `assignUniqueIds`, `matchInline`, `buildCalendarCells`, `fmtTimestamp`,
  `paragraphs.ts` DOM helpers — all covered.
- `store.svelte.ts` — both native and web paths exercised, including
  quota-exceeded fallback.
- `mcp/src/meetings.ts` — including path-traversal hardening, partial-day ISO
  bounds, malformed file tolerance.

### 3.2 What's not tested
- **Every Svelte component**: `App`, `Editor`, `Sidebar`, `Header`,
  `Settings`, `MeetingMeta`, `MeetingName`, `OatpadTitle`, `ThemeToggle`,
  `Coachmark`, `GettingStarted`. UI-state edge cases — sidebar resize
  clamping, delete-confirm timeout (`Sidebar.svelte:198`), search-mode
  toggle, settings bubble height measurement, coachmark positioning — are
  entirely uncovered.
- **Editor pipeline integration**: how Quill text-change feeds into
  `onTextChange` + `reconcileNoteIds` + `persistSnapshot`. The unit pieces
  are tested but their composition isn't. A jsdom + Quill harness (`Editor`
  spawns a Quill, the test simulates `setContents` / `insertText`) would
  catch regressions in `Editor.svelte:116-132`.
- **Tauri Rust side**: `install_mcpb` (`src/src/lib.rs:9-24`) has no tests.
  Reasonable for a 30-line shell-out, but the path-resolution and
  per-OS branching could regress silently.
- **Updater state machine** (`Settings.svelte`): five states, three
  promises, timeouts. Pure function extracted out + unit-tested would
  pin down the install/relaunch ordering and the spinner-floor timing
  for future maintainers.
- **`markdown.ts`**: no test confirming Turndown output is what callers
  expect (line breaks, code blocks, nested lists, inline code escaping).

### 3.3 One stale test fixture
`store.test.ts` covers native `deleteMeetingById` and `initMeeting` only.
`switchMeeting`, `setNotetaker` (native path), `replaceMeetingFromFile`
(native path), and the `flushPersist` debounce all exist on the same module
and are untested in the native variant. The web variant tests are more
complete — bring native parity up to that level.

---

## 4. Minor smells and nits

### 4.1 Over-broad type in `Editor.svelte`
`Editor.svelte:38`:
```ts
function emit(events: ReturnType<typeof onTextChange>["events"]): void
```
That's `OatsEvent[]`. Spelling it out would be clearer than reaching through
two type derivations.

### 4.2 `mcp/server/` JS sits in the working tree even though it's gitignored
`mcp/.gitignore` excludes `server/` (the build output of `tsc`). Locally, the
`server/index.js` and `server/meetings.js` files are present (you read them
above). This is fine — they're not committed — but a fresh checkout that
reads `manifest.json:14` (`"entry_point": "server/index.js"`) and tries to
run the bundle without a build will fail confusingly. A first-run guard or a
`postinstall` hook in `mcp/package.json` would help.

### 4.3 `Settings.svelte`'s `runUpdateCheck` self-guards cleverly via `untrack`
`Settings.svelte:91-94` wraps the initial call in `untrack` because the
function reads `updateState` synchronously and would otherwise re-fire the
effect on every state transition. A more durable pattern is a module-level
or component-level `let initialized = false` flag. Today's code works but
relies on subtle Svelte 5 effect-tracking semantics that future maintainers
may not preserve.

### 4.4 The `Sidebar` settings/search `prevSearchOpen` / `prevSettingsOpen`
trick in `$effect` (`Sidebar.svelte:104-122`) uses closure-captured
non-`$state` mutable variables, which works only because the effect is
guaranteed to re-run when `searchOpen` / `settingsOpen` change. It's
correct, but a future refactor that touches the effect's dependency set
could break it silently. Promote to `$state` or document the invariant
inline.

### 4.5 `meetings.ts` JSON-roundtrip detach
`meetings.ts:23` does `JSON.parse(JSON.stringify(file))` to dodge
`structuredClone`'s issue with Svelte 5 proxies. The comment is good, but
the helper is duplicated conceptually with `appendEvents` / `setSnapshot` in
`store.svelte.ts` which mutate the proxy directly. A single
`toDetachedOatsFile(meeting: Meeting): OatsFile` (already exists as
`toOatsFileFrom` — `store.svelte.ts:349`) used everywhere would tighten the
boundary.

### 4.6 `fmtTimestamp` and `fmt` in `MeetingMeta` use locale "en-GB"
Hardcoded locale shows up in `calendar.ts:57,70,76` and
`MeetingMeta.svelte:48`. Fine if Oatpad is a personal app, but if it ever
ships beyond, prefer `undefined` (system locale) or thread a setting through.

### 4.7 `paragraphs.ts` DOM coupling is shaped around Quill but pretends not
to be
The "block elements are direct children of root" assumption
(`paragraphs.ts:7-11`) is exactly Quill's bubble-theme structure. The module
has no Quill import — but it cannot be reused with any other rich-text
editor that nests blocks differently. Either acknowledge the dependency in
the module's name (`quillParagraphs.ts`) or genuinely abstract it.

### 4.8 `noteFlush.ts` exports test-only helpers
`commonPrefixLen`, `commonSuffixLen` — the comment at
`noteFlush.ts:273-274` flags them `@internal`. JSDoc `@internal` won't be
enforced; if these grow tests of their own elsewhere (which the test file
does), there's no compile-time signal. Move to a sibling
`noteFlush.internal.ts` or rely on `// @ts-expect-error` via a private
re-export pattern — or just leave it as today's note. Lowest priority.

### 4.9 `Header.svelte` web-mode and native-mode action rows duplicate
`<button class="icon-btn">` patterns
The web-mode `.actions` block (`Header.svelte:144-171`) reuses the same
icon-btn styling as native's `expanded-icons`, but the buttons are written
out separately. With three near-identical `<button>` elements in each
branch, an `IconButton` Svelte child component would shrink Header to ~250
lines.

---

## 5. Architecture observations (no change requested, just naming the shape)

### 5.1 The state model is event-sourcing-lite
`OatsEvent[]` is the source of truth; `snapshot` is a Quill-Delta cache;
`reducer.ts:replay` rebuilds note state from events. This is sound and the
SPEC's preservation requirements depend on it. The MCP server reads the
events and the snapshot independently, never the in-memory `Meeting` —
which keeps the contract clean.

### 5.2 Two persistence backends, one shape
`localStorage` (web) vs. `.oats` files in AppData (native). The shape is
identical, the UX differs (web has explicit Save/Open, native autosaves).
This is well-handled. The split between
`hasUnsavedWork` (web-only check) vs. autosave (native-implicit) lives in
`store.svelte.ts` and the call sites in `App.svelte`. Worth noting that
native mode has no concept of "discard this meeting" — once a `New` is
clicked, the previous meeting is on disk forever unless explicitly deleted.
That seems intentional given the spec, but it's worth flagging in a
design doc.

### 5.3 Fresh mode (`VITE_FRESH=1`) is a dev affordance, not a runtime one
Threaded through `freshMode.ts` and consulted by `store`, `meetings`,
`theme`, `paragraphGap`. Each module checks the flag independently. This is
clean enough but it's a *cross-cutting concern* and there's no single point
that says "we're in fresh mode now". If the list of fresh-aware modules
grows, a thin "persistence adapter" layer would let fresh-mode swap one
adapter for an in-memory one rather than each module re-implementing the
"if fresh, return default; if no localStorage, return default" pattern.

---

## 6. Suggested priority order if you act on this

1. SPEC.md vs. recording-id (§1.6) — implement or amend.
2. Sidebar.svelte split — see `PLAN_SIDEBAR_SPLIT.md`.
3. Shared schema between `mcp/src` and `src-web/lib` — see
   `PLAN_SHARED_SCHEMA.md`.
4. Extract the updater state machine to a pure function and add tests
   (§3.2). Same pattern for the MCP install machine.
5. Settings.svelte split (§2.2) — natural follow-on to #2.
6. `store.svelte.ts` native/web split (§2.6).

Everything in §4 is paint, not load-bearing.
