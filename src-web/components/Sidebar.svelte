<script lang="ts">
  import * as store from "../lib/store.svelte";
  import {
    monthStart,
    ymdLocal,
    buildCalendarCells,
    fmtMonth,
    fmtTimestamp,
  } from "../lib/calendar";
  import { labelFor, filterMeetings } from "../lib/meetingFilter";
  import { tick } from "svelte";
  import { slide, scale } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { backOut } from "svelte/easing";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Check from "@lucide/svelte/icons/check";
  import Search from "@lucide/svelte/icons/search";
  import Calendar from "@lucide/svelte/icons/calendar";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Settings from "./Settings.svelte";

  type Props = {
    collapsed: boolean;
    width: number;
    onswitch: (id: string) => void;
    ondelete: (id: string) => void | Promise<void>;
    searchOpen?: boolean;
    oncloseSearch?: () => void;
    settingsOpen?: boolean;
    oncloseSettings?: () => void;
  };
  let {
    collapsed,
    width,
    onswitch,
    ondelete,
    searchOpen = false,
    oncloseSearch,
    settingsOpen = false,
    oncloseSettings,
  }: Props = $props();

  type SearchMode = "text" | "date";
  let searchMode = $state<SearchMode>("text");
  let searchQuery = $state("");
  let selectedDate = $state<string | null>(null);
  let viewMonth = $state(monthStart(new Date()));
  let searchInputEl: HTMLInputElement | undefined = $state();
  let bubbleEl: HTMLDivElement | undefined = $state();
  // Both modes are rendered simultaneously in an absolutely-stacked layout
  // so each can be measured independently. The active content's measured
  // height drives the body's animated height *and* the spacer's height
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
  // Total spacer height: the body's content-stack plus the body's vertical
  // padding (6 + 8) plus the bubble's padding-top (6) plus 4px breathing.
  const SPACER_OVERHEAD = 24;
  const spacerHeight = $derived(
    searchOpen ? Math.max(42, activeContentHeight + SPACER_OVERHEAD) : 0,
  );
  // The contents are hidden until the bubble's pop animation completes — they're
  // mounted from t=0 but native input rendering (border/caret/etc.) and the
  // calendar grid can briefly peek through the scaling bubble, which reads as
  // a square flash. Holding them back until the pop settles makes the entrance
  // feel staged: bubble first, contents after.
  let contentsVisible = $state(false);
  $effect(() => {
    if (!searchOpen) {
      contentsVisible = false;
      searchMode = "text";
      selectedDate = null;
      viewMonth = monthStart(new Date());
    }
  });

  // Settings bubble — its own measured-height-driven spacer so it grows
  // and shrinks in lockstep with whatever widgets land inside, sharing
  // the same easing the search bubble uses.
  let settingsHeight = $state(96);
  let settingsContentsVisible = $state(false);
  let settingsBubbleEl: HTMLDivElement | undefined = $state();

  // When either bubble closes, the spacer above the meeting list shrinks
  // smoothly — but the rows themselves just translate as a rigid block.
  // Adding a per-row settle animation makes them feel like a concertina
  // collapsing back: each row starts slightly displaced and bounces into
  // place, with the wave staggering down the list and decaying so the
  // bottom rows settle quietly. The class is toggled for the animation's
  // duration; CSS handles the per-row delay/amplitude via --idx.
  let listWobbling = $state(false);
  // INVARIANT: prevSearchOpen/prevSettingsOpen are intentionally NOT $state.
  // They mirror the previous run's prop values so the effect can detect a
  // close transition (was-open → now-closed). Promoting them to $state
  // would make the effect track its own writes and re-fire spuriously.
  // The effect is guaranteed to run when searchOpen/settingsOpen flip
  // (those are reactive props), which is the only time we need to update
  // them — closure-captured plain `let` is the right shape here.
  let prevSearchOpen = false;
  let prevSettingsOpen = false;
  let listWobbleTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const justClosed =
      (prevSearchOpen && !searchOpen) ||
      (prevSettingsOpen && !settingsOpen);
    prevSearchOpen = searchOpen;
    prevSettingsOpen = settingsOpen;
    if (!justClosed) return;
    listWobbling = false;
    // Force a reflow so re-adding the class the next tick actually
    // re-triggers the animation when bubbles open/close in quick
    // succession.
    requestAnimationFrame(() => {
      listWobbling = true;
      if (listWobbleTimer) clearTimeout(listWobbleTimer);
      listWobbleTimer = setTimeout(() => {
        listWobbling = false;
      }, 700);
    });
  });
  const settingsSpacerHeight = $derived(
    settingsOpen ? Math.max(48, settingsHeight + SPACER_OVERHEAD) : 0,
  );
  $effect(() => {
    if (!settingsOpen) settingsContentsVisible = false;
  });

  function handleSettingsKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      oncloseSettings?.();
    }
  }

  // YMD keys for meetings, used to mark calendar days that have meetings.
  const meetingDates = $derived(
    new Set(store.state.meetings.map((m) => ymdLocal(new Date(m.createdAt)))),
  );

  const calendarCells = $derived(
    buildCalendarCells(viewMonth, meetingDates, new Date()),
  );

  function shiftMonth(delta: number): void {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() + delta);
    viewMonth = monthStart(d);
  }

  function pickDate(ymd: string): void {
    // Re-clicking the active day clears the filter — saves a trip back to text mode.
    selectedDate = selectedDate === ymd ? null : ymd;
  }

  function enterDateMode(): void {
    searchMode = "date";
    // If a previously-selected date sits outside the current view, jump there
    // so the user sees their selection.
    if (selectedDate) {
      const [y, m] = selectedDate.split("-").map(Number);
      viewMonth = new Date(y, m - 1, 1);
    }
  }

  async function enterTextMode(): Promise<void> {
    searchMode = "text";
    selectedDate = null;
    // Wait for Svelte to mount the input before focusing it.
    await tick();
    searchInputEl?.focus();
  }

  const filteredMeetings = $derived(
    filterMeetings(store.state.meetings, searchMode, searchQuery, selectedDate),
  );

  function handleSearchKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      oncloseSearch?.();
    }
  }

  function handleBubbleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      oncloseSearch?.();
    }
  }

  // Inline two-step delete: first click on a row's trash icon arms it
  // (turns red, swaps to a check) and a second click on the same row's
  // armed icon commits. Arming auto-cancels after a short window so an
  // accidental click never lingers, and starting a different row's
  // confirm cancels the previous one.
  const CONFIRM_TIMEOUT_MS = 3000;
  let confirmingId = $state<string | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  function clearConfirm(): void {
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    confirmingId = null;
  }

  function handleDelete(id: string): void {
    if (confirmingId === id) {
      clearConfirm();
      void ondelete(id);
      return;
    }
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmingId = id;
    confirmTimer = setTimeout(() => {
      confirmTimer = null;
      confirmingId = null;
    }, CONFIRM_TIMEOUT_MS);
  }

  // ESC cancels an armed delete from anywhere — the trash button itself
  // can't catch the keyup once focus has drifted, so this lives at the
  // sidebar level. Same goes for switching meetings: the user picking a
  // different row signals they no longer mean to delete the armed one.
  function handleSidebarKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && confirmingId) {
      e.preventDefault();
      clearConfirm();
    }
  }

  function handleSwitch(id: string): void {
    // Any row activation cancels an armed delete — picking a meeting to
    // open (even the same one whose trash is armed) is an explicit
    // "I want this meeting" signal, the opposite of "delete it". Without
    // this, clicking the body of an armed row would open the meeting
    // *and* leave the row red-tinted with the check icon visible, so a
    // single follow-up click on that icon would silently delete what the
    // user just opened.
    if (confirmingId) clearConfirm();
    onswitch(id);
  }
</script>

{#if !collapsed}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside
    class="sidebar"
    style:width="{width}px"
    transition:slide={{ axis: "x", duration: 180 }}
    onkeydown={handleSidebarKeydown}
  >
    <!-- Spacer holds the layout space below the bubble. Its height is
         computed from the same activeContentHeight that drives the body's
         content-stack — same source, same easing — so the spacer and the
         bubble grow/shrink in lockstep without one trailing the other. -->
    <div
      class="search-spacer"
      style:height="{Math.max(spacerHeight, settingsSpacerHeight)}px"
    ></div>
    {#if settingsOpen}
      <div class="search-bubble-anchor">
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          bind:this={settingsBubbleEl}
          class="search-bubble settings-bubble"
          out:scale={{ duration: 100 }}
          onanimationend={() => {
            settingsContentsVisible = true;
            // Focus the bubble itself so ESC reaches handleSettingsKeydown
            // even before the user interacts with anything inside.
            settingsBubbleEl?.focus({ preventScroll: true });
          }}
          onkeydown={handleSettingsKeydown}
          role="dialog"
          aria-label="Settings"
          tabindex="-1"
        >
          <span class="search-arrow settings-arrow" aria-hidden="true"></span>
          <div class="search-body settings-body">
            <div
              class="settings-stack"
              class:visible={settingsContentsVisible}
              bind:clientHeight={settingsHeight}
            >
              <Settings />
            </div>
          </div>
        </div>
      </div>
    {/if}
    {#if searchOpen}
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
            if (searchMode === "text") searchInputEl?.focus();
          }}
          onkeydown={handleBubbleKeydown}
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
                 bubble (and via clientHeight, the spacer) along with it. -->
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
                  onkeydown={handleSearchKeydown}
                  tabindex={searchMode === "text" ? 0 : -1}
                />
                <button
                  class="mode-btn"
                  onclick={enterDateMode}
                  aria-label="Filter by date"
                  title="Filter by date"
                  tabindex={searchMode === "text" ? 0 : -1}
                >
                  <Calendar size={14} strokeWidth={2} />
                </button>
              </div>
              <div
                class="cal"
                class:active={searchMode === "date"}
                bind:clientHeight={calHeight}
                aria-hidden={searchMode !== "date"}
              >
                <div class="cal-header">
                  <button
                    class="mode-btn"
                    onclick={enterTextMode}
                    aria-label="Search by text"
                    title="Search by text"
                    tabindex={searchMode === "date" ? 0 : -1}
                  >
                    <Search size={13} strokeWidth={2} />
                  </button>
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
                        class:selected={selectedDate === cell.ymd}
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
    {/if}
    <ul class="list" class:wobbling={listWobbling}>
      {#each filteredMeetings as summary, i (summary.meetingId)}
        {@const current = store.state.meeting?.meetingId === summary.meetingId}
        {@const label = labelFor(summary.title)}
        {@const confirming = confirmingId === summary.meetingId}
        <li
          class="row"
          class:current
          class:confirming
          style:--idx={i}
          animate:flip={{ duration: 320, easing: backOut }}
        >
          <button
            class="row-main"
            onclick={() => handleSwitch(summary.meetingId)}
            title={confirming ? "Click trash again to confirm" : label}
          >
            <span class="row-label">
              {confirming ? "Confirm delete?" : label}
            </span>
          </button>
          <!-- The row-main button already provides keyboard access; this
               div is a mouse-only secondary affordance so the timestamp
               column is also clickable. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="row-right"
            onclick={() => handleSwitch(summary.meetingId)}
          >
            <span class="row-time">{fmtTimestamp(summary.createdAt)}</span>
            <button
              class="row-del"
              onclick={(e) => {
                e.stopPropagation();
                handleDelete(summary.meetingId);
              }}
              aria-label={confirming
                ? `Confirm delete "${label}"`
                : `Delete "${label}"`}
              title={confirming
                ? "Click again to confirm"
                : "Delete meeting"}
            >
              {#if confirming}
                <Check size={14} strokeWidth={2} />
              {:else}
                <Trash2 size={14} strokeWidth={2} />
              {/if}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  </aside>
{/if}

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    overflow: hidden;
    flex-shrink: 0;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 12px 0 6px;
    overflow: auto;
    flex: 1;
    min-height: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 2px 8px;
    padding: 0 4px;
    border-radius: 8px;
  }
  /* Per-row settle: rows above the bubble's footprint were rigidly
     shifted up by the spacer transition; this animation rides on top
     of that and gives each row a small bounce as it lands. The wave
     staggers downward so the eye reads it as a concertina folding
     shut, and both the amplitude and the time spent oscillating
     decay so deeper rows settle quietly. The starting `--amp`
     pushes the row downward by amp at t=0, then the spring-bezier
     overshoots back through zero and lets it ring out to rest. */
  .list.wobbling .row {
    --amp: max(4px, calc(20px - var(--idx, 0) * 1.6px));
    animation: listSettle 340ms cubic-bezier(0.32, 1.85, 0.6, 1) backwards;
    animation-delay: calc(var(--idx, 0) * 18ms);
  }
  @keyframes listSettle {
    0% {
      transform: translateY(var(--amp));
    }
    100% {
      transform: translateY(0);
    }
  }
  .row:not(.current):hover {
    background: color-mix(in srgb, var(--fg) 6%, transparent);
  }
  .row.current {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .row-main {
    flex: 1;
    cursor: pointer;
    padding: 7px 8px;
    overflow: hidden;
    color: var(--fg);
    text-align: left;
    min-width: 0;
  }
  .row-label {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13.5px;
  }
  .row.current .row-label {
    color: var(--accent);
  }
  /* Right slot: timestamp sits at the right edge by default. Hovering the
     slot scoots the timestamp left to make room for the trash icon, which
     slides in from the right. Both are visible together on hover.
     min-width is sized for the hover state (timestamp + gap + trash) so
     the row-main column doesn't reflow when the trash appears. */
  .row-right {
    position: relative;
    flex: 0 0 auto;
    min-width: 76px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 8px;
    cursor: pointer;
  }
  .row-time {
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    user-select: none;
    transition: transform 160ms ease;
  }
  .row-right:hover .row-time,
  .row-right:focus-within .row-time,
  .row.confirming .row-time {
    transform: translateX(-30px);
  }
  .row-del {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translate(8px, -50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    color: var(--icon);
    opacity: 0;
    transition:
      opacity 160ms ease,
      transform 160ms ease,
      color 160ms ease;
  }
  .row-right:hover .row-del,
  .row-right:focus-within .row-del,
  .row.confirming .row-del {
    opacity: 1;
    transform: translate(0, -50%);
  }
  .row-del:hover {
    color: var(--icon-active);
  }
  /* Armed-for-deletion state: tint the whole row red so the danger
     reads at a glance, swap the label to "Confirm delete?", and
     keep the trash (now a check) visible regardless of hover so the
     user can see exactly what's about to vanish. */
  .row.confirming {
    background: color-mix(in srgb, var(--danger, #d33) 14%, transparent);
  }
  .row.confirming.current {
    background: color-mix(in srgb, var(--danger, #d33) 22%, transparent);
  }
  .row.confirming .row-label,
  .row.confirming .row-time,
  .row.confirming .row-del,
  .row.confirming .row-del:hover {
    color: var(--danger, #d33);
  }

  /* Search bubble — mirrors the Quill bubble look. The arrow's right offset
     is computed from the icon-tray geometry in Header.svelte:
       12px (left-col padding-right)
     +  32px (toggle-slot)
     +   4px (expanded-icons margin-right)
     +  32px (new-slot)
     +   4px (gap)
     +  16px (half search-slot width)
     = 100px from the sidebar's right edge.
     The bubble's right margin is 12px, so the arrow's centre sits 88px from
     the bubble's right edge — i.e. its right border at 82px.
     The wrap holds the layout space so the list slides smoothly to make
     room; the bubble inside pops in with a brief scale + fade. */
  /* Height is set inline from activeContentHeight + the bubble/body's
     fixed overhead, and 0 when the search is closed. The CSS transition
     smooths every change with the same overshoot bezier the bubble's
     pop-in uses, so opening, closing, and mode switching all share the
     same little springy feel. */
  .search-spacer {
    flex-shrink: 0;
    transition: height 140ms cubic-bezier(0.34, 1.25, 0.64, 1);
  }
  .search-bubble-anchor {
    position: absolute;
    top: 0;
    left: 12px;
    right: 12px;
    z-index: 1;
  }
  .search-bubble {
    --bubble-bg: color-mix(in srgb, var(--surface) 70%, var(--fg) 30%);
    position: relative;
    padding-top: 6px;
    /* Pop emanates from just below the search icon, where the arrow sits. */
    transform-origin: calc(100% - 88px) 0;
    /* The entry uses a CSS animation rather than a Svelte transition because
       Svelte applies tick(0) on requestAnimationFrame, leaving one frame
       where the bubble paints at its natural (full) size — that's the
       square-ended flash the user was seeing. `animation-fill-mode: backwards`
       guarantees the 0% keyframe is painted from the very first frame.
       The 30ms delay lets the spacer's slide get started, so the bubble
       only becomes visible once there's space for it. */
    animation: pop-in 160ms linear 30ms backwards;
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
    right: 82px;
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 6px solid var(--bubble-bg);
  }
  /* Settings bubble's arrow sits over the cog (the leftmost icon in the
     expanded tray). Position derived the same way as .search-arrow:
       12px (left-col padding-right)
     +  32px (toggle-slot)
     +   4px (expanded-icons margin-right)
     +  32px (new-slot)
     +   4px (gap)
     +  32px (search-slot)
     +   4px (gap)
     +  16px (half settings-slot width)
     = 136px from sidebar's right edge.
     Bubble's right margin is 12px and the arrow's apex sits 6px in from
     its right edge — so right: 136 - 12 - 6 = 118px. */
  .settings-arrow {
    right: 118px;
  }
  .settings-bubble {
    /* Pop emanates from just below the cog. */
    transform-origin: calc(100% - 124px) 0;
  }
  .settings-body {
    padding: 8px 12px 10px;
  }
  .settings-stack {
    opacity: 0;
    transition: opacity 150ms ease;
  }
  .settings-stack.visible {
    opacity: 1;
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
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
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
    transition: height 180ms cubic-bezier(0.34, 1.25, 0.64, 1);
  }
  .text-row,
  .cal {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 150ms ease;
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
      color 120ms ease,
      background-color 120ms ease;
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
    transition: background-color 120ms ease;
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
  .cal-cell.selected.has-meeting::after {
    background: var(--accent);
  }
</style>
