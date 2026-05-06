<script lang="ts">
  import * as store from "../lib/store.svelte";
  import { labelFor } from "../lib/meetingFilter";
  import { fmtTimestamp } from "../lib/calendar";
  import type { MeetingSummary } from "../lib/meetings";
  import { flip } from "svelte/animate";
  import { backOut } from "svelte/easing";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Check from "@lucide/svelte/icons/check";
  import Clock from "@lucide/svelte/icons/clock";

  type Props = {
    meetings: MeetingSummary[];
    wobbling: boolean;
    onswitch: (id: string) => void;
    ondelete: (id: string) => void | Promise<void>;
  };
  let { meetings, wobbling, onswitch, ondelete }: Props = $props();

  // Inline two-step delete: first click on a row's trash icon arms it
  // (turns red, swaps to a check) and a second click on the same row's
  // armed icon commits. Arming auto-cancels after a short window so an
  // accidental click never lingers, and starting a different row's
  // confirm cancels the previous one.
  const CONFIRM_TIMEOUT_MS = 3000;
  let confirmingId = $state<string | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  // Returns true when an armed delete was actually cleared. The sidebar
  // shell's Escape handler calls this and uses the boolean to decide
  // whether to preventDefault — Escape doesn't belong to us when nothing
  // was armed.
  export function clearConfirm(): boolean {
    if (confirmingId === null) return false;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    confirmingId = null;
    return true;
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

<ul class="list" class:wobbling>
  {#each meetings as summary, i (summary.meetingId)}
    {@const current = store.state.meeting?.meetingId === summary.meetingId}
    {@const label = labelFor(summary.title)}
    {@const confirming = confirmingId === summary.meetingId}
    {@const scheduledOnly =
      !!summary.scheduledStartAt && !summary.started}
    {@const rowTime = scheduledOnly && summary.scheduledStartAt
      ? summary.scheduledStartAt
      : summary.createdAt}
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
        {#if scheduledOnly}
          <span
            class="scheduled-icon"
            aria-label="Scheduled to start"
            title="Scheduled to start"
          >
            <Clock size={12} strokeWidth={2} />
          </span>
        {/if}
        <span class="row-time">{fmtTimestamp(rowTime)}</span>
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

<style>
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
  .scheduled-icon {
    display: inline-flex;
    align-items: center;
    margin-right: 4px;
    color: color-mix(in srgb, var(--muted) 80%, transparent);
    transition: transform 160ms ease;
  }
  /* Slide alongside the time column when the trash icon swings in. */
  .row-right:hover .scheduled-icon,
  .row-right:focus-within .scheduled-icon,
  .row.confirming .scheduled-icon {
    transform: translateX(-30px);
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
</style>
