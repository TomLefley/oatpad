<script lang="ts">
  import { tick } from "svelte";
  import { scale } from "svelte/transition";
  import {
    monthStart,
    ymdLocal,
    buildCalendarCells,
    fmtMonth,
  } from "../lib/calendar";
  import type { SearchMode } from "../lib/meetingFilter";
  import * as store from "../lib/store.svelte";
  import Search from "@lucide/svelte/icons/search";
  import Calendar from "@lucide/svelte/icons/calendar";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import X from "@lucide/svelte/icons/x";

  type Props = {
    onclose: () => void;
    // Filter state lives in the parent so it survives this bubble's
    // mount/unmount cycle (the bubble lives behind {#if searchOpen} so it
    // can outro). Bindable so the bubble's controls write through.
    searchMode: SearchMode;
    searchQuery: string;
    // rangeStart alone is a single-day filter; both set is an inclusive
    // range. Both null = no date filter.
    rangeStart: string | null;
    rangeEnd: string | null;
    viewMonth: Date;
    // Active content height — the parent reads this to size the spacer
    // above the meeting list so the list slides clear in lockstep with
    // the bubble's body height transition.
    contentHeight: number;
  };
  let {
    onclose,
    searchMode = $bindable(),
    searchQuery = $bindable(),
    rangeStart = $bindable(),
    rangeEnd = $bindable(),
    viewMonth = $bindable(),
    contentHeight = $bindable(),
  }: Props = $props();

  const hasDateSelection = $derived(rangeStart !== null);

  let searchInputEl: HTMLInputElement | undefined = $state();
  let bubbleEl: HTMLDivElement | undefined = $state();

  // Both modes are rendered simultaneously in an absolutely-stacked layout
  // so each can be measured independently. The active content's measured
  // height drives the body's animated height *and* the parent's spacer
  // directly — same source value, same transition timing — so they glide
  // in lockstep instead of one chasing the other via a clientHeight
  // observer (which would double-smooth and cause lag).
  // Seeded with sensible initial estimates so the first open doesn't briefly
  // collapse to 0 while the ResizeObserver catches up; real measurements
  // replace these after first paint.
  let textHeight = $state(22);
  let calHeight = $state(240);
  const activeContentHeight = $derived(
    searchMode === "text" ? textHeight : calHeight,
  );
  $effect(() => {
    contentHeight = activeContentHeight;
  });

  // The contents are hidden until the bubble's pop animation completes — they're
  // mounted from t=0 but native input rendering (border/caret/etc.) and the
  // calendar grid can briefly peek through the scaling bubble, which reads as
  // a square flash. Holding them back until the pop settles makes the entrance
  // feel staged: bubble first, contents after.
  let contentsVisible = $state(false);

  const meetingDates = $derived(
    new Set(store.state.meetings.map((m) => ymdLocal(new Date(m.createdAt)))),
  );
  const calendarCells = $derived(
    buildCalendarCells(
      viewMonth,
      meetingDates,
      new Date(),
      rangeStart,
      rangeEnd,
    ),
  );

  function shiftMonth(delta: number): void {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() + delta);
    viewMonth = monthStart(d);
  }

  // Click model: 1st click sets a single-day filter (rangeStart only). 2nd
  // click on a *different* day extends to a range, swapping endpoints if
  // needed so start ≤ end. 3rd click (after a range is set) starts a fresh
  // single-day selection. Re-clicking the start while no end is set clears.
  function pickDate(ymd: string): void {
    if (rangeStart && rangeEnd) {
      rangeStart = ymd;
      rangeEnd = null;
      return;
    }
    if (!rangeStart) {
      rangeStart = ymd;
      return;
    }
    if (ymd === rangeStart) {
      rangeStart = null;
      rangeEnd = null;
      return;
    }
    if (ymd < rangeStart) {
      rangeEnd = rangeStart;
      rangeStart = ymd;
    } else {
      rangeEnd = ymd;
    }
  }

  function clearTextQuery(): void {
    searchQuery = "";
    searchInputEl?.focus();
  }

  function clearDateSelection(): void {
    rangeStart = null;
    rangeEnd = null;
  }

  function enterDateMode(): void {
    searchMode = "date";
    // If a previously-selected date sits outside the current view, jump there
    // so the user sees their selection.
    if (rangeStart) {
      const [y, m] = rangeStart.split("-").map(Number);
      viewMonth = new Date(y, m - 1, 1);
    }
  }

  async function enterTextMode(): Promise<void> {
    searchMode = "text";
    rangeStart = null;
    rangeEnd = null;
    // Wait for Svelte to mount the input before focusing it.
    await tick();
    searchInputEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    }
  }
</script>

<!-- Bubble lives in an absolutely-positioned anchor over the spacer
     area, so it can render with rounded ends regardless of the
     spacer's height during the slide. -->
<div class="search-bubble-anchor">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={bubbleEl}
    class="search-bubble"
    out:scale={{ duration: 100 }}
    onanimationend={() => {
      contentsVisible = true;
      // Focus a sensible target so Escape reaches the bubble's keydown
      // handler without the user having to click first. In text mode the
      // input is the obvious target; in date mode (e.g. when reopening
      // with a previously-applied date filter) we focus the bubble shell
      // itself.
      if (searchMode === "text") {
        searchInputEl?.focus();
      } else {
        bubbleEl?.focus({ preventScroll: true });
      }
    }}
    onkeydown={handleKeydown}
    role="dialog"
    aria-label="Search meetings"
    tabindex="-1"
  >
    <span class="search-arrow" aria-hidden="true"></span>
    <div class="search-body" class:date-mode={searchMode === "date"}>
      <!-- Both modes are always present in the DOM so each can settle to
           its natural height. They're absolutely stacked inside this
           container, whose height is driven by whichever mode is
           active — that height transitions smoothly, dragging the
           bubble (and via contentHeight, the parent's spacer) along with it. -->
      <div
        class="content-stack"
        class:visible={contentsVisible}
        style:height="{activeContentHeight}px"
      >
        <div
          class="text-row"
          class:active={searchMode === "text"}
          bind:clientHeight={textHeight}
        >
          <input
            bind:this={searchInputEl}
            bind:value={searchQuery}
            class="search-input"
            type="text"
            placeholder="Search meetings"
            tabindex={searchMode === "text" ? 0 : -1}
          />
          {#if searchQuery !== ""}
            <button
              class="mode-btn"
              onclick={clearTextQuery}
              aria-label="Clear search"
              title="Clear search"
              tabindex={searchMode === "text" ? 0 : -1}
            >
              <X size={14} strokeWidth={2} />
            </button>
          {:else}
            <button
              class="mode-btn"
              onclick={enterDateMode}
              aria-label="Filter by date"
              title="Filter by date"
              tabindex={searchMode === "text" ? 0 : -1}
            >
              <Calendar size={14} strokeWidth={2} />
            </button>
          {/if}
        </div>
        <div
          class="cal"
          class:active={searchMode === "date"}
          bind:clientHeight={calHeight}
          aria-hidden={searchMode !== "date"}
        >
          <div class="cal-header">
            <button
              class="cal-nav"
              onclick={() => shiftMonth(-1)}
              aria-label="Previous month"
              title="Previous month"
              tabindex={searchMode === "date" ? 0 : -1}
            >
              <ChevronLeft size={14} strokeWidth={2} />
            </button>
            <span class="cal-month-label">{fmtMonth(viewMonth)}</span>
            <button
              class="cal-nav"
              onclick={() => shiftMonth(1)}
              aria-label="Next month"
              title="Next month"
              tabindex={searchMode === "date" ? 0 : -1}
            >
              <ChevronRight size={14} strokeWidth={2} />
            </button>
            {#if hasDateSelection}
              <button
                class="mode-btn"
                onclick={clearDateSelection}
                aria-label="Clear date filter"
                title="Clear date filter"
                tabindex={searchMode === "date" ? 0 : -1}
              >
                <X size={13} strokeWidth={2} />
              </button>
            {:else}
              <button
                class="mode-btn"
                onclick={enterTextMode}
                aria-label="Search by text"
                title="Search by text"
                tabindex={searchMode === "date" ? 0 : -1}
              >
                <Search size={13} strokeWidth={2} />
              </button>
            {/if}
          </div>
          <div class="cal-weekdays" aria-hidden="true">
            <span>Mo</span><span>Tu</span><span>We</span><span>Th</span
            ><span>Fr</span><span>Sa</span><span>Su</span>
          </div>
          <div class="cal-grid">
            {#each calendarCells as cell, i (i)}
              {#if cell === null}
                <span class="cal-cell empty"></span>
              {:else}
                <button
                  class="cal-cell"
                  class:has-meeting={cell.hasMeeting}
                  class:today={cell.isToday}
                  class:selected={cell.isRangeStart || cell.isRangeEnd}
                  class:range-start={cell.isRangeStart && rangeEnd !== null}
                  class:range-end={cell.isRangeEnd}
                  class:in-range={cell.inRange}
                  onclick={() => pickDate(cell.ymd)}
                  aria-label={cell.ymd}
                  tabindex={searchMode === "date" ? 0 : -1}
                >{cell.day}</button>
              {/if}
            {/each}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  /* Search bubble — mirrors the Quill bubble look. The arrow's right offset
     is computed from the icon-tray geometry in Header.svelte. The atoms
     (--icon-size, --icon-gap, --tray-padding-right, etc.) live in app.css
     and own the source-of-truth values. */
  .search-bubble-anchor {
    position: absolute;
    top: 0;
    left: 12px;
    right: 12px;
    z-index: 1;
  }
  .search-bubble {
    position: relative;
    padding-top: var(--bubble-arrow-padding);
    /* Pop emanates from just below the search icon, where the arrow sits. */
    transform-origin: calc(
      100% - (var(--tray-search-center) - var(--bubble-margin))
    ) 0;
    /* The entry uses a CSS animation rather than a Svelte transition because
       Svelte applies tick(0) on requestAnimationFrame, leaving one frame
       where the bubble paints at its natural (full) size — that's the
       square-ended flash the user was seeing. `animation-fill-mode: backwards`
       guarantees the 0% keyframe is painted from the very first frame.
       The 30ms delay lets the spacer's slide get started, so the bubble
       only becomes visible once there's space for it. */
    animation: pop-in var(--anim-pop) linear 30ms backwards;
    outline: none;
  }
  /* Two-phase pop: ease-out launch from 0.58 scale, overshoot to 1.07 at
     the midpoint, then a damped settle back to 1. Pronounced enough that
     the "pop" reads, but not rubbery. */
  @keyframes pop-in {
    0% {
      transform: scale(0.58);
      opacity: 0;
      animation-timing-function: cubic-bezier(0.2, 0.8, 0.4, 1);
    }
    65% {
      transform: scale(1.07);
      opacity: 1;
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }
  .search-arrow {
    position: absolute;
    top: 0;
    right: calc(
      var(--tray-search-center) - var(--bubble-margin) - var(--bubble-arrow-half)
    );
    width: 0;
    height: 0;
    border-left: var(--bubble-arrow-half) solid transparent;
    border-right: var(--bubble-arrow-half) solid transparent;
    border-bottom: var(--bubble-arrow-half) solid var(--bubble-bg);
  }
  .search-body {
    background: var(--bubble-bg);
    /* Fixed radius (rather than 9999px) so the corners don't briefly clamp
       to half-min-dimension as the bubble grows — when width ≈ height the
       9999px-clamped corners would render the body as nearly a circle,
       which is what made the text→date expansion look wonky. At 18px the
       text-mode body (~36px tall) reads as a pill (corners ≈ half-height)
       and the date-mode body reads as a softly-rounded rectangle. */
    border-radius: 18px;
    box-shadow: var(--bubble-shadow);
    /* Unified padding so contents don't horizontally jog when modes switch.
       6/10/8 is a compromise: tight enough that the text-mode pill stays
       slim and roomy enough that the calendar grid below has breathing
       room above and beneath. */
    padding: 6px 10px 8px;
  }
  /* Both modes are absolutely stacked here so each can settle to its own
     natural height; the stack's animated height drives the bubble's size.
     Matched timing/easing with the spacer means they move as one. */
  .content-stack {
    position: relative;
    transition: height var(--anim-slide) var(--ease-spring);
  }
  .text-row,
  .cal {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--anim-fast) ease;
  }
  .content-stack.visible .text-row.active,
  .content-stack.visible .cal.active {
    opacity: 1;
    pointer-events: auto;
  }
  .text-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  /* Selector is `input.search-input` rather than just `.search-input` to
     beat the global `input[type="text"]` rule in app.css on specificity —
     otherwise the input renders with its own 1px border, 6px radius, and
     opaque surface background, which flashes as a square inside the
     pill during the pop. */
  input.search-input {
    all: unset;
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    color: var(--fg);
    font-family: var(--font-sans);
    font-size: 13.5px;
    line-height: 1.5;
  }
  input.search-input:focus {
    outline: none;
  }
  input.search-input::placeholder {
    color: color-mix(in srgb, var(--fg) 55%, transparent);
  }

  /* Mode toggle button — appears as a subtle calendar/search icon tucked
     into the bubble. Clicking it swaps the bubble's contents. */
  .mode-btn,
  .cal-nav {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: color-mix(in srgb, var(--fg) 60%, transparent);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      color var(--anim-fast) ease,
      background-color var(--anim-fast) ease;
  }
  .mode-btn:hover,
  .cal-nav:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .mode-btn:focus-visible,
  .cal-nav:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }

  .cal-header {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 4px;
  }
  .cal-month-label {
    flex: 1;
    text-align: center;
    font-size: 12.5px;
    color: var(--fg);
    font-weight: 500;
    user-select: none;
  }
  .cal-weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    font-size: 10px;
    color: color-mix(in srgb, var(--fg) 50%, transparent);
    text-align: center;
    padding: 2px 0 4px;
    user-select: none;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .cal-cell {
    all: unset;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    border-radius: 6px;
    color: var(--fg);
    cursor: pointer;
    position: relative;
    box-sizing: border-box;
    transition: background-color var(--anim-fast) ease;
  }
  .cal-cell:hover:not(.empty):not(.selected) {
    background: color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .cal-cell:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .cal-cell.empty {
    cursor: default;
  }
  /* Days that have meetings get a small dot beneath the number — quietly
     telegraphs which days are clickable-meaningful before the user picks. */
  .cal-cell.has-meeting::after {
    content: "";
    position: absolute;
    bottom: 3px;
    left: 50%;
    width: 3px;
    height: 3px;
    margin-left: -1.5px;
    border-radius: 50%;
    background: var(--accent);
  }
  .cal-cell.today {
    color: var(--accent);
    font-weight: 600;
  }
  .cal-cell.selected {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    color: var(--accent);
  }
  /* In-range days get a softer wash than the endpoints, so the eye still
     reads start/end as distinct anchors with a connecting fill between. */
  .cal-cell.in-range {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
    border-radius: 0;
  }
  /* When endpoints are part of a multi-day range, square off the inner
     edge of each so the wash flows visually into the in-range run. */
  .cal-cell.range-start {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .cal-cell.range-end {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .cal-cell.selected.has-meeting::after {
    background: var(--accent);
  }
</style>
