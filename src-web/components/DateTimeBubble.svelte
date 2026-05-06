<script lang="ts">
  /*
   * Date+time picker bubble used by MeetingMeta.
   *
   * Visually echoes SearchBubble's calendar grid (same atoms / weekday
   * row / cell shape) so the app has one consistent calendar look, but
   * doesn't reuse SearchBubble directly — that component is wired to
   * the icon-tray geometry, owns text/date mode toggling, and decorates
   * cells with meeting dots, none of which are appropriate here.
   *
   * The bubble holds a draft selection. Clicking a date or changing
   * the time updates the draft only — the visible footer button is
   * the explicit commit gesture. This is two-stage on purpose:
   * scheduling a meeting is a deliberate action and the user should
   * be able to scrub through dates / times to find the right one
   * without each scrub firing a sidebar refresh + autosave.
   *
   * When a schedule already exists, the footer's Schedule button is
   * replaced by a pair of icon buttons: Update (commit the draft) and
   * Clear (drop the schedule via onClear).
   */
  import {
    monthStart,
    buildCalendarCells,
    fmtMonth,
    ymdLocal,
  } from "../lib/calendar";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CalendarClock from "@lucide/svelte/icons/calendar-clock";
  import CalendarX2 from "@lucide/svelte/icons/calendar-x-2";

  type Props = {
    // Currently-displayed datetime as an ISO instant. Used to seed
    // the calendar's view month, the selected day, and the time field.
    value: string;
    // Whether a scheduled time is already committed on the meeting.
    // Switches the footer between "Schedule" (set) and "Update / Clear"
    // (modify).
    hasSchedule: boolean;
    onCommit: (iso: string) => void;
    onClose: () => void;
    onClear: () => void;
  };
  let { value, hasSchedule, onCommit, onClose, onClear }: Props = $props();

  function pad(n: number): string {
    return String(n).padStart(2, "0");
  }

  // Seed local state from the incoming ISO. We deliberately don't
  // re-sync these on prop changes — the bubble is short-lived (closes
  // when the user dismisses it) and within its lifespan we want the
  // user's in-progress selection to be authoritative.
  // svelte-ignore state_referenced_locally
  const seed = new Date(value);
  // Frozen seed snapshots — drive the dirty indicators (time-input
  // highlight + footer-button dot). Plain consts because they never
  // change for the lifetime of one bubble instance.
  const seedYmd = ymdLocal(seed);
  const seedTime = `${pad(seed.getHours())}:${pad(seed.getMinutes())}`;
  let viewMonth = $state(monthStart(seed));
  let selectedYmd = $state(seedYmd);
  let timeStr = $state(seedTime);

  const timeChanged = $derived(timeStr !== seedTime);
  const dateChanged = $derived(selectedYmd !== seedYmd);
  const dirty = $derived(timeChanged || dateChanged);

  let bubbleEl: HTMLDivElement | undefined = $state();

  const today = new Date();
  // No meeting-dot decorations on this calendar — pass an empty set.
  const cells = $derived(
    buildCalendarCells(viewMonth, new Set<string>(), today),
  );

  function draftIso(): string | null {
    if (!selectedYmd) return null;
    const [y, m, d] = selectedYmd.split("-").map(Number);
    const [hh, mm] = timeStr.split(":").map(Number);
    if (
      [y, m, d, hh, mm].some((n) => Number.isNaN(n)) ||
      m === undefined ||
      d === undefined
    ) {
      return null;
    }
    // Construct in local time then serialize to UTC ISO. This keeps
    // the picker's "user picks 3pm" semantically equal to the user's
    // wall clock, regardless of timezone.
    const dt = new Date(y, m - 1, d, hh ?? 0, mm ?? 0, 0, 0);
    return dt.toISOString();
  }

  function commitDraft(): void {
    const iso = draftIso();
    if (iso) onCommit(iso);
  }

  function shiftMonth(delta: number): void {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() + delta);
    viewMonth = monthStart(d);
  }

  function pickDate(ymd: string): void {
    selectedYmd = ymd;
  }

  function handleTime(e: Event): void {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (!v) return;
    timeStr = v;
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={bubbleEl}
  class="datetime-bubble"
  role="dialog"
  aria-label="Set scheduled start"
  tabindex="-1"
  onkeydown={handleKeydown}
>
  <span class="bubble-arrow" aria-hidden="true"></span>
  <div class="bubble-body">
    <div class="cal">
      <div class="cal-header">
        <button
          class="cal-nav"
          onclick={() => shiftMonth(-1)}
          aria-label="Previous month"
          title="Previous month"
        >
          <ChevronLeft size={14} strokeWidth={2} />
        </button>
        <span class="cal-month-label">{fmtMonth(viewMonth)}</span>
        <button
          class="cal-nav"
          onclick={() => shiftMonth(1)}
          aria-label="Next month"
          title="Next month"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
      </div>
      <div class="cal-weekdays" aria-hidden="true">
        <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span
          >Fr</span><span>Sa</span><span>Su</span>
      </div>
      <div class="cal-grid">
        {#each cells as cell, i (i)}
          {#if cell === null}
            <span class="cal-cell empty"></span>
          {:else}
            <button
              class="cal-cell"
              class:today={cell.isToday}
              class:selected={selectedYmd === cell.ymd}
              onclick={() => pickDate(cell.ymd)}
              aria-label={cell.ymd}
            >{cell.day}</button>
          {/if}
        {/each}
      </div>
      <div class="footer">
        <input
          type="time"
          class="time-input"
          class:changed={timeChanged}
          aria-label="Scheduled time"
          value={timeStr}
          onchange={handleTime}
        />
        <div class="actions">
          {#if hasSchedule}
            <button
              class="action-btn icon-only"
              onclick={commitDraft}
              aria-label="Update scheduled time"
              title="Update scheduled time"
            >
              <CalendarClock size={14} strokeWidth={2} />
              {#if dirty}
                <span class="dot" aria-hidden="true"></span>
              {/if}
            </button>
            <button
              class="action-btn icon-only"
              onclick={onClear}
              aria-label="Clear scheduled time"
              title="Clear scheduled time"
            >
              <CalendarX2 size={14} strokeWidth={2} />
            </button>
          {:else}
            <button
              class="action-btn schedule-btn"
              onclick={commitDraft}
              aria-label="Schedule meeting"
              title="Schedule meeting"
            >
              <CalendarClock size={14} strokeWidth={2} />
              <span>Schedule</span>
              {#if dirty}
                <span class="dot" aria-hidden="true"></span>
              {/if}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .datetime-bubble {
    --bubble-bg: color-mix(in srgb, var(--surface) 70%, var(--fg) 30%);
    position: absolute;
    top: calc(100% + 8px);
    left: 12px;
    z-index: 5;
    /* Mirror SearchBubble's pop entrance for visual continuity. */
    transform-origin: 24px 0;
    animation: dt-pop-in 160ms linear backwards;
    outline: none;
  }
  @keyframes dt-pop-in {
    0% {
      transform: scale(0.6);
      opacity: 0;
      animation-timing-function: cubic-bezier(0.2, 0.8, 0.4, 1);
    }
    65% {
      transform: scale(1.05);
      opacity: 1;
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }
  .bubble-arrow {
    position: absolute;
    top: -6px;
    left: 18px;
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 6px solid var(--bubble-bg);
  }
  .bubble-body {
    background: var(--bubble-bg);
    border-radius: 14px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
    padding: 8px 10px 10px;
    width: 240px;
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
  .cal-nav:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .cal-nav:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
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
  .cal-cell.today {
    color: var(--accent);
    font-weight: 600;
  }
  .cal-cell.selected {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    color: var(--accent);
  }
  /* Footer: time on the left, action group on the right. */
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid color-mix(in srgb, var(--fg) 12%, transparent);
  }
  .time-input {
    all: unset;
    font-family: var(--font-sans);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    color: var(--fg);
    padding: 2px 6px;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  .time-input:hover,
  .time-input:focus {
    background: color-mix(in srgb, var(--fg) 8%, transparent);
  }
  /* Dirty highlight: the time field stands out once the user has
     changed it from the seeded value, so they can see at a glance
     which half of the picker is responsible for a pending edit. */
  .time-input.changed {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--accent);
  }
  .time-input.changed:hover,
  .time-input.changed:focus {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .time-input::-webkit-calendar-picker-indicator {
    /* Keep clickable but de-emphasize the platform's button — the field
       text itself opens the picker on click. */
    opacity: 0.4;
    cursor: pointer;
  }
  .actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .action-btn {
    all: unset;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    cursor: pointer;
    border-radius: 6px;
    color: color-mix(in srgb, var(--fg) 75%, transparent);
    transition:
      color 120ms ease,
      background-color 120ms ease;
  }
  /* Pending-commit indicator — same shape and pop animation as the
     header notification dot so the language is consistent across
     bubbles. Pinned to the icon-or-button corner via the action-btn's
     positioning context. */
  .action-btn .dot {
    position: absolute;
    top: 0;
    right: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 1.5px var(--bubble-bg);
    pointer-events: none;
    animation: dt-dot-pop 220ms cubic-bezier(0.34, 1.5, 0.64, 1) backwards;
  }
  @keyframes dt-dot-pop {
    0% {
      transform: scale(0);
      opacity: 0;
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }
  .action-btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
  .schedule-btn {
    padding: 4px 8px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }
  .schedule-btn:hover {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .icon-only {
    width: 26px;
    height: 26px;
  }
  .icon-only:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--fg) 10%, transparent);
  }
</style>
