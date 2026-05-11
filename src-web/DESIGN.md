# Oatpad design system

The single source of truth for how Oatpad looks and moves. Treat this
file as a checklist when building anything new — if your feature reads
as foreign, it's probably skipping something here.

## File map

| Concern        | File                                |
| -------------- | ----------------------------------- |
| Colour palette | [`palette.css`](./palette.css)      |
| Motion         | [`motion.css`](./motion.css)        |
| Typography     | [`typography.css`](./typography.css) |
| Layout atoms   | [`layout.css`](./layout.css)        |
| Globals + Quill overrides | [`app.css`](./app.css)   |

Tokens are imported in `main.ts` before `app.css` so every Svelte
component style block can reference them via `var(--…)`.

## Colour

The palette pairs a warm cream light theme with a roasted dark theme.
Both are defined in `palette.css` via [`light-dark()`][lightdark] so
each value lives in exactly one place. `:root[data-theme="light"|
"dark"]` pins `color-scheme` to override the system preference; the
rest is automatic.

[lightdark]: https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark

### Semantic tokens

Use these in component styles — never reach for a raw hex.

| Token              | Use                                                |
| ------------------ | -------------------------------------------------- |
| `--bg`             | App background (window, sidebar collapsed slot)    |
| `--surface`        | Panel surfaces (header, sidebar list, popovers)    |
| `--surface-hover`  | Subtle hover background for surfaces               |
| `--fg`             | Default body text                                  |
| `--muted`          | Secondary text (timestamps, captions)              |
| `--border`         | Hairlines and input borders                        |
| `--accent`         | Primary action / active-state colour               |
| `--icon`           | Resting icon colour                                |
| `--icon-active`    | Hovered / active icon colour                       |
| `--link`           | Hyperlinks inside the editor                       |
| `--danger`         | Destructive actions, confirm-delete states        |
| `--bubble-bg`      | Mixed surface used by every popover bubble         |
| `--bubble-shadow`  | The drop shadow that gives bubbles their lift      |

### Recurring tints

Hover / active / pressed states are built with `color-mix(in srgb, …)`
rather than fresh tokens. These percentages recur — match them so the
app's intensity reads consistently:

| Mix recipe                                | Where it appears                       |
| ----------------------------------------- | -------------------------------------- |
| `var(--fg) 6%, transparent`               | Subtle row hover                       |
| `var(--fg) 8–10%, transparent`            | Button / chip hover                    |
| `var(--fg) 12%, transparent`              | Divider / soft separator               |
| `var(--fg) 18%, transparent`              | Pressed-state background, slider track |
| `var(--accent) 14%, transparent`          | Light accent fill (selected day)       |
| `var(--accent) 18%, transparent`          | Current-row tint, theme-button active  |
| `var(--accent) 22–28%, transparent`       | Hover/active reinforcement on accents  |
| `var(--danger) 14% / 22%, transparent`    | Armed-for-delete row tint              |

If you need a tint that isn't on this list, pause and check whether one
of these would do — adding new percentages erodes the rhythm.

### Adding a colour

1. Decide whether it's a *semantic* token (used across screens for a
   recognisable role) or a one-off mix (a tint of an existing token).
2. One-offs: use `color-mix()` against an existing token in the
   component style.
3. Semantic tokens: add to `palette.css` with both light and dark
   values via `light-dark()`, then list it in the table above.

## Motion

`motion.css` exposes the app's motion vocabulary as duration and
easing tokens. Components reach for names, never literal milliseconds.

### Durations

| Token                  | Value  | Intent                                  |
| ---------------------- | ------ | --------------------------------------- |
| `--anim-fast`          | 120ms  | Hover / colour transitions              |
| `--anim-slide`         | 180ms  | Width / height changes (sidebar, spacer)|
| `--anim-pop`           | 160ms  | Bubble entry pop                        |
| `--anim-wobble`        | 340ms  | List / editor settle wobble             |
| `--anim-dot`           | 220ms  | Notification dot pop-in                 |
| `--anim-collapse`      | 600ms  | Header tray collapse hold window        |
| `--anim-wobble-window` | 700ms  | Wobble class lifetime after a close     |

### Easings

| Token            | Curve                                | Intent                          |
| ---------------- | ------------------------------------ | ------------------------------- |
| `--ease-spring`  | `cubic-bezier(0.34, 1.25, 0.64, 1)`  | Gentle overshoot — bubbles open |
| `--ease-bounce`  | `cubic-bezier(0.32, 1.85, 0.6, 1)`   | Pronounced overshoot — settles  |

### Patterns

- **Pop in** (bubbles, coachmarks): two-phase keyframes — `scale(0.58)`
  → `scale(1.07)` at ~65% → `scale(1)`. `animation-fill-mode: backwards`
  paints the 0% frame from frame zero so there's no full-size flash.
  See `SearchBubble` `@keyframes pop-in`.
- **Slide-and-settle** (sidebar, header tray): width/height transition
  in `--anim-slide` `--ease-spring`, then a staggered per-row wobble
  ringing back to rest at `--anim-wobble` `--ease-bounce`.
- **Wobble cascade** (tray icons on collapse/expand): each icon owns
  an `--idx` and an `--amp`; `animation-delay` is `idx * 45ms` and
  amplitudes decay sharply so the wave reads as a rubber-band unfurl.
  See `Header.svelte` `.toggle-slot`, `.new-slot`, `.search-slot`,
  `.settings-slot`.
- **Cross-fade morph** (toggle icon swap): stack two icons absolutely,
  cross-fade opacity over `--anim-slide` and rotate/scale via a 240ms
  spring so the swap reads as momentum rather than a substitution.
- **Dot pop-in** (notification dots): plays once on mount via
  `animation-fill-mode: backwards` so remounts (e.g. close-with-filter)
  also play it as a quiet "look here".

If you need new motion, prefer composing these patterns over inventing
a new curve. Reach for a fresh token only when *every* call site of an
existing one would be wrong.

## Layout

`layout.css` owns the geometric atoms used by the header, sidebar, and
bubbles. The bubble arrows derive their positions from the icon-tray
centres — if you change `--icon-size` or `--icon-gap`, every arrow
re-aligns automatically. Don't hand-derive offsets from these values
in component styles; reference the atoms directly.

| Token                          | Use                                       |
| ------------------------------ | ----------------------------------------- |
| `--icon-size` (32px)           | Every icon-button hit area                |
| `--icon-gap` (4px)             | Gap between adjacent tray icons           |
| `--traffic-light-clearance`    | Left padding on the native header column  |
| `--tray-padding-right`         | Right padding inside the icon tray        |
| `--bubble-radius` (14px)       | Default radius for popover bubbles        |
| `--bubble-margin` (12px)       | Bubble distance from window edge          |
| `--bubble-arrow-half` (6px)    | Arrow base half-width                     |
| `--bubble-arrow-padding` (6px) | Vertical breathing above the bubble body  |
| `--tray-*-center`              | Right-relative centre of each tray icon   |

## Typography

The single typography token is `--font-sans`, set in `typography.css`
and applied on `html`. Component-level font sizes live alongside the
component — copying them into shared tokens makes changes harder to
reason about, not easier. Add a size token only when the same value
genuinely recurs across unrelated components.

Recurring sizes you'll see in the wild:

- 11px — row timestamps, captions
- 12–13px — secondary labels, settings rows
- 13.5px — sidebar row labels
- 14px — getting-started buttons
- 17px — Quill editor body

## Spacing

Spacing is intentionally not tokenised globally — most paddings live
with the component that owns them. There's a `--spacing` custom
property used by the Quill editor (managed via `lib/spacing.ts`); it
controls the gap between adjacent block elements in the editor only.
Don't reuse it for component layout.

When picking paddings, lean on the cadence already in the codebase:
**4 · 6 · 8 · 10 · 12 · 16 · 18 px**. Aim for one of these before
inventing a 7 or 11.

## UI primitives

### Icon buttons

Every clickable icon should sit in a 32×32 hit area (`--icon-size`).
Use the `IconButton` component for the common case:

```svelte
<IconButton onclick={handler} label="What it does">
  <Lucide size={18} strokeWidth={2} />
</IconButton>
```

Resting colour is `var(--icon)`; hover and `active` swap to
`var(--icon-active)`. Lucide icons render at **size 18, strokeWidth 2**
unless they're small dismiss/close glyphs, which use **size 14,
strokeWidth 2.4** for visual weight parity at a smaller size.

When you need extras the component doesn't expose (notification dots,
custom layered children, wobble class targeting), drop down to a
hand-rolled button that mirrors `.icon-btn`'s rules rather than
forking the component — see `Header.svelte` for the canonical
expanded version.

### Labelled buttons

Reserve labelled buttons for *significant* affordances — the kind a
user reads and decides on, not a passing utility. `GettingStarted`'s
"Start a new meeting" is the model:

- `.primary`: background `--accent`, foreground `--bg`,
  `border-radius: 8px`, padding `10px 18px`, font 14px.
- `.secondary`: transparent background, `--border` outline,
  hover into `--surface-hover` and border into a darker mix.
- Focus ring: `outline: 2px solid var(--accent)` with a 2px offset.

### Bubbles

The bubble primitive — search, settings, datetime, coachmark — is a
recognisable shape across the app:

- `background: var(--bubble-bg)`
- `box-shadow: var(--bubble-shadow)`
- Radius: `var(--bubble-radius)` (14px) for square-ish bubbles, 18px
  for pill-shaped bodies (search input)
- Arrow: 6px (`--bubble-arrow-half`) triangle, tinted to `--bubble-bg`,
  positioned via the `--tray-*-center` atoms
- Entry: `pop-in` animation at `--anim-pop`, with a ~30ms delay if the
  bubble appears after a spacer/sidebar slide finishes opening

If you add a new popover, reach for these tokens before writing CSS.
Differences should be limited to *where* the arrow lands and the
transform origin.

### Notification dots

A 7px round, accent-coloured, ringed with `--surface` so it pops over
any header background. Only show a dot when its bubble is *closed* —
once the user can see the underlying state, the dot is noise.

### Danger / confirm-delete states

Arm-then-confirm rather than dialogs. Look at MeetingList's
`.row.confirming`:

- Whole row tints to `color-mix(in srgb, var(--danger) 14%, transparent)`
- Current-row variant tints harder: 22%
- Foreground text, time, and icon all flip to `var(--danger)`
- The confirm icon stays visible regardless of hover so the user can
  see exactly what's about to vanish

Apply the same recipe to any other destructive flow rather than
introducing a fresh red.

## Theming

`lib/theme.ts` exposes `loadTheme` / `saveTheme` / `applyTheme` /
`cycleTheme`. `applyTheme("system")` removes the `data-theme`
attribute so `prefers-color-scheme` takes over; `"light"` or `"dark"`
pin `color-scheme` and resolve `light-dark()` accordingly. The cycle
order is system → light → dark.

## Accessibility checklist

- Every actionable control has `aria-label` (or visible text).
- Bubble triggers expose `aria-expanded`.
- Focus rings: native `outline` or a 1–2px `outline` in `--accent`
  with positive `outline-offset`. Don't suppress focus styles.
- Live regions (`role="dialog"`, `aria-live`) for coachmarks.

## Adding a new feature — checklist

1. **Colour**: use semantic tokens; mix via `color-mix(in srgb, …)`
   at the recurring percentages above. No raw hex.
2. **Motion**: pick a duration token; pick `--ease-spring` /
   `--ease-bounce` if you need overshoot. Mirror the existing patterns
   (pop / slide-and-settle / wobble cascade).
3. **Layout**: derive from `--icon-size` / `--bubble-*` atoms instead
   of hand-derived px. Spacings on the 4·6·8·10·12·16·18 cadence.
4. **Primitives**: prefer `IconButton` for icon affordances;
   `.primary` / `.secondary` styling for labelled buttons;
   the bubble recipe for popovers.
5. **Theming**: ensure the feature reads correctly in both light and
   dark — `light-dark()` does most of the work, but verify any new
   `color-mix` tints against both themes.
6. **Accessibility**: `aria-label`, `aria-expanded`, focus rings.
7. **Tests**: component tests sit alongside the component
   (`*.test.ts`). Use `testSetup.ts` patterns.

When in doubt, find the closest existing component and copy its
shape — that's the fastest way to stay coherent.
