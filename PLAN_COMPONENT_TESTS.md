# Plan — Component and editor-pipeline test coverage

## Goal

Close the two largest test gaps from the code review:

1. Every Svelte component is currently uncovered. Several have
   non-trivial UI state edge cases (sidebar resize clamping,
   delete-confirm timeout, search-mode toggle, settings-bubble
   height measurement, coachmark positioning).
2. The Editor pipeline's *integration* — Quill text-change feeding
   into `onTextChange` + `reconcileNoteIds` + `persistSnapshot` — is
   not tested. The unit pieces are tested in isolation
   (`noteFlush.test.ts`, `quillParagraphs.test.ts`, `noteIds.test.ts`)
   but their composition isn't.

## Why now

- The unit-tested core pipeline (`noteFlush.ts`, ~1k LoC of tests)
  catches algorithm regressions but not wiring regressions. A
  jsdom + Quill harness is the only thing that catches
  "we forgot to call reconcileNoteIds before readParagraphs"
  class bugs.
- Component state machines (delete confirmation, bubble open/close,
  list wobble, sidebar resize) are entirely uncovered. They are the
  most likely place a future refactor introduces a regression — see
  `PLAN_SIDEBAR_SPLIT.md`, which would benefit from these tests
  existing first.

## Out of scope (skip these)

- **Tauri Rust `install_mcpb` tests.** REVIEW §3.2 itself notes the
  30-line shell-out is reasonable to leave uncovered.
- **Visual regression / screenshot testing.** Animation timing,
  bubble pop choreography, and CSS transitions are not in scope —
  these are manually verified.
- **End-to-end / Playwright tests.** Out of scope; vitest + jsdom
  is sufficient for everything below.

## Suggested target shape

Add component tests under `src-web/components/<name>.test.ts`
co-located with the component, following the same
`@vitest-environment jsdom` pattern already used for
`quillParagraphs.test.ts` and the existing markdown / DOM tests.

For Svelte 5 component testing, use
[`@testing-library/svelte`](https://testing-library.com/docs/svelte-testing-library/intro/)
with `vitest`. Add it as a devDependency at the root if the agent
agrees that's the cleanest harness — the existing tests don't mount
components, so this would be the first.

### Priority list (do in this order)

The components vary widely in test value and effort. Tackle in
roughly this order, stopping when the user pulls the plug:

1. **Editor pipeline integration** (highest value).
   - Mount `Editor.svelte` in jsdom, let Quill construct itself.
   - Drive via Quill's API (`quill.setContents`, `quill.insertText`,
     `quill.getSelection`) — *not* by simulating keypresses, because
     jsdom's keyboard model doesn't fully match a real browser.
   - Cases to pin: a typed paragraph reaches `appendEvents` with the
     expected `note_*` events; reload restores noteIds; new
     paragraphs get fresh ids via reconcileNoteIds; flush() emits
     pending events; persistSnapshot only reads ids (not markdown)
     when called from `onTextChange`.
   - Mock `lib/store.svelte` so the test can assert on the events
     it would have appended.
   - This catches the §1.4 bubble-toolbar wiring regression that
     fired in this review (covered in passing — but a real
     regression test for `addToolbarTooltips` would also be cheap).

2. **Sidebar.svelte** (highest regression risk).
   - The delete-confirmation state machine: arming, second-click
     commits, timeout cancels, switching rows cancels.
   - Search-mode toggle: text ↔ calendar transitions, selectedDate
     persistence, filter-meeting integration.
   - Bubble open/close + the `prevSearchOpen` / `prevSettingsOpen`
     invariant from REVIEW §4.4 — once tests pin the behaviour,
     `PLAN_SIDEBAR_SPLIT.md` becomes much safer to execute.
   - Settings-bubble height measurement (the `settingsHeight` /
     `SPACER_OVERHEAD` calculation).

3. **Settings.svelte / McpRow / UpdaterRow.**
   - UpdaterRow's machine is already unit-tested in
     `lib/updater.test.ts`. Component-level tests would only need
     to assert on rendering: spinner shows when `machine.spinning`,
     "vX.Y.Z available!" appears when ready, button disabled when
     busy. Light coverage is enough.
   - McpRow: install button toggles between "install" and
     "reinstall", toggle reflects `mcpEnabled`, both buttons
     disabled until `configLoaded`. Mock `loadConfig` /
     `saveConfig` / `invoke`.
   - Settings.svelte itself: theme picker (clicking each option
     calls `applyTheme`), paragraph-gap slider (oninput calls
     `setParagraphGap`).

4. **App.svelte.**
   - Sidebar resize-clamping (drag + clamp to MIN_W / MAX_W).
   - Coachmark show/dismiss logic — `showCoachmark` derived flag
     covers three conditions.
   - Bubble exclusivity (opening search closes settings and vice
     versa).
   - LocalStorage persistence of sidebar width (read on load,
     write on change, clamping persisted values that pre-date a
     MIN_W bump).

5. **Header.svelte.**
   - The collapse-transition wobble logic (`prevExpanded`,
     `collapsing` flag, the 600ms timer).
   - Native vs. web mode rendering.
   - IconButton wiring (now that it's extracted, just check the
     web-mode buttons fire their callbacks).

6. **Coachmark.svelte.**
   - Position calculation against a target rect.
   - Dismissal on target focus, X click, Escape.
   - ResizeObserver / window.resize repositioning.

7. **Lower-value components** — defer or skip:
   - `MeetingMeta.svelte`: phase computation already unit-tested in
     `meetingPhase.test.ts`; component just renders.
   - `MeetingName.svelte` / `OatpadTitle.svelte`: behaviour is in
     `EditableLabel` (test that one instead — see #8).
   - `ThemeToggle.svelte`: trivial.
   - `GettingStarted.svelte`: trivial.
   - `IconButton.svelte`: trivial.

8. **EditableLabel.svelte** — worth one focused file.
   - Draft mirrors `value` when not focused.
   - Edits don't get clobbered by external changes during focus.
   - Enter blurs, Escape resets + blurs, focus selects all,
     blur calls `onCommit` with trimmed value.

## Constraints

- All tests must run in `npm test` and `cd mcp && npm test` without
  network or filesystem access. Mock the Tauri plugins
  (`@tauri-apps/api/core`, `@tauri-apps/plugin-updater`,
  `@tauri-apps/plugin-process`) per-test or via a shared setup.
- The existing test suite (231 passing as of plan-time) must remain
  green. No flaky tests — if a timing-dependent test flakes, fake
  the clock with `vi.useFakeTimers`.
- Don't expand `tsconfig.json` to include test-only types in the
  app build. Keep test-runtime imports inside `.test.ts` files.
- For Quill in jsdom: it works, but selection APIs are partial.
  Drive Quill through its public API rather than DOM events where
  possible.

## Verification

- `npm run check` — svelte-check clean (current baseline: 0 errors,
  0 warnings).
- `npm test` — all tests pass, including the new ones.
- Coverage report (`npx vitest run --coverage`) — broadly more
  green than before. Don't chase a percentage; chase the gaps
  the priority list calls out.

## Pitfalls

- **Svelte 5 component mount in vitest.** The runtime is different
  enough from Svelte 4 that examples from the docs may need
  updating. If `@testing-library/svelte` doesn't mount cleanly, fall
  back to `mount()` from `svelte` itself.
- **Quill in jsdom.** Quill creates its own DOM nodes and listens on
  the global selection API. jsdom implements selection but not
  perfectly. If a test needs a full selection round-trip and jsdom
  fights, either skip it or move to a `happy-dom` environment for
  that one file.
- **Async effects in tests.** Svelte 5's `$effect` is asynchronous;
  use `await flushSync()` or `await tick()` to settle before
  asserting.
- **Mock leakage between files.** Each test file should reset its
  mocks. The existing pattern in `store.test.ts` (`vi.mock` at the
  top of the file, `vi.resetModules()` between tests) is the
  reference.
- **jsdom date / timezone.** Two existing tests (`calendar.test.ts`)
  pin behaviour with `timeZone: "UTC"` options. Replicate when
  testing `MeetingMeta` if it lands in scope.

## Starting point for the agent

Files to read first:

- `src-web/lib/store.test.ts` — the established mock + reset pattern.
- `src-web/lib/quillParagraphs.test.ts` — the jsdom + DOM-helpers
  pattern.
- `src-web/lib/noteFlush.test.ts` — the largest test file in the
  repo, illustrative of how the team writes tests.
- `src-web/lib/updater.test.ts` — recently added, illustrates
  dep-injected machine testing for an async state machine.
- `src-web/components/Editor.svelte` — the integration target.
- `REVIEW.md` §3.2 — the original review framing for this gap.
