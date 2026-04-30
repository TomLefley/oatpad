# Plan — Split `Sidebar.svelte` into focused components

## Goal

Break `src-web/components/Sidebar.svelte` (~895 LoC) into smaller, single-
purpose components so each concern is independently navigable, testable,
and less prone to collateral regression.

## Why

The file currently mixes four jobs:

1. The meeting list and its delete-confirmation state machine.
2. The search bubble (text + calendar modes, animated transitions).
3. The settings bubble (already delegates body to `Settings.svelte`, but
   owns the bubble shell, animation, and height measurement).
4. The list-wobble choreography that fires when a bubble closes.

Touching one concern requires navigating around the others. This is the
most likely place in the codebase to introduce regressions. The file is
on track to cross 1000 LoC if left alone.

## Suggested target shape

Inside `src-web/components/`:

- `Sidebar.svelte` — thin shell that composes the children below; owns
  the collapsed/expanded outer frame and the props that come in from
  `App.svelte`.
- `MeetingList.svelte` — the rendered list, the row-level click and
  delete handlers, and the delete-confirmation timeout state machine.
- `SearchBubble.svelte` — the search input, the calendar mode toggle,
  the animated transitions, and any keydown handling specific to it.
- `SettingsBubble.svelte` — the bubble shell around `<Settings />` plus
  any settings-specific bubble animation/height logic.

The split lines aren't sacred — pick what reads cleanest as you go. The
current `prevSearchOpen` / `prevSettingsOpen` `$effect` block at
`Sidebar.svelte:104-122` orchestrates cross-bubble behaviour; whichever
component (or shared helper) ends up owning that effect needs the
relationship documented inline.

## Constraints

- The prop contract with `App.svelte` (`collapsed`, `width`, `onswitch`,
  `ondelete`, `searchOpen`, `oncloseSearch`, `settingsOpen`,
  `oncloseSettings`) must not change. `App.svelte` is out of scope unless
  a prop becomes genuinely redundant after the split — call that out in
  the PR if so.
- All four animation invariants must still work end-to-end:
  - Bubble open/close (the search and settings bubbles).
  - List wobble when a bubble closes.
  - Sidebar collapse, in concert with the icon-tray wobble in
    `Header.svelte` (durations are coupled — see the 420ms + 45ms-stagger
    comment at `Header.svelte:310-325`).
  - Search ↔ calendar mode toggle.
- ARIA roles and keyboard shortcuts (`Escape` to close, focus management
  on bubble open) must stay intact.
- Fold the byte-identical `handleSearchKeydown` / `handleBubbleKeydown`
  duplicates (`Sidebar.svelte:179` and `:186`) into one helper as part of
  the split — that's review item §2.7, low effort and naturally lands here.
- Don't fold `Settings.svelte` itself. It's already a separate component,
  and it has its own pending split (REVIEW §2.2) that's out of scope.

## Verification

- `npm test` and `cd mcp && npm test` — all green (current baseline:
  189 + 27 passing).
- `npm run check` — svelte-check clean (current baseline: 0 errors).
- `just run` (native) and `just run-web` (web) — manual exercise:
  - bubble open / bubble close / bubble switch (search ↔ settings)
  - list wobble after a bubble close
  - sidebar collapse with each bubble open and closed
  - search → calendar mode toggle
  - delete-row confirmation, including the timeout reset
  - Escape key dismissal
  - keyboard focus order

## Pitfalls

- Svelte 5 `$state` and `$effect` semantics: when state moves between
  files, the tracking context changes. Watch especially for
  `prevSearchOpen` / `prevSettingsOpen` (`Sidebar.svelte:104-122`) —
  those are closure-captured non-`$state` mutables that work only
  because the effect happens to re-run on every change. If you migrate
  them, either keep the same shape (and document why) or promote to
  `$state` deliberately.
- The wobble choreography is timing-coupled. When you copy the CSS,
  copy the explanatory comments alongside the keyframes — they document
  the durations, the per-icon stagger, and which way the wave radiates.
- Geometry magic numbers are documented at `App.svelte:57-59` and
  duplicated in CSS in both `Header.svelte` and `Sidebar.svelte`
  (e.g. `.search-arrow { right: 82px }`). Don't try to fix that here —
  it's REVIEW §2.3 and conflates two separate refactors.

## Out of scope

- `Settings.svelte` split (REVIEW §2.2).
- Header / sidebar geometry constants (REVIEW §2.3).
- Component test coverage for the new components (REVIEW §3.2). Stub
  files are welcome but don't block this PR on tests.

## Starting point for the agent

The current file is `src-web/components/Sidebar.svelte`. The relevant
context lives in:

- `src-web/App.svelte` — props passed in.
- `src-web/components/Header.svelte` — animation timings to keep in
  sync.
- `src-web/components/Settings.svelte` — already separate; renders inside
  the settings bubble.
- `REVIEW.md` §2.1, §2.7 — the original review framing.
