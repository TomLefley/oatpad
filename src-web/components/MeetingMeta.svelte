<script lang="ts">
  import * as store from "../lib/store.svelte";
  import { editBounds, phaseFor, type Phase } from "../lib/meetingPhase";
  import { LOCALE } from "../lib/locale";
  import CalendarClock from "@lucide/svelte/icons/calendar-clock";
  import DateTimeBubble from "./DateTimeBubble.svelte";

  const createdAt = $derived(store.state.meeting?.createdAt);
  const scheduledStartAt = $derived(store.state.meeting?.scheduledStartAt);

  const bounds = $derived(
    editBounds(
      store.state.meeting?.events ?? [],
      store.state.firstInputAt,
      store.state.lastInputAt,
    ),
  );

  let phase = $state<Phase>("none");

  // Self-driving chain: each timeout advances `phase` and schedules the next.
  // Re-runs whenever the latest edit changes (a new edit resets the clock).
  $effect(() => {
    const last = bounds.last;
    if (!last) {
      phase = "none";
      return;
    }
    const lastMs = new Date(last).getTime();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = (): void => {
      const since = Date.now() - lastMs;
      phase = phaseFor(since, true);
      if (phase === "live") {
        timer = setTimeout(tick, 60_000 - since + 50);
      } else if (phase === "idle") {
        timer = setTimeout(tick, 180_000 - since + 50);
      }
    };
    tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  });

  const startTs = $derived(bounds.first ?? createdAt ?? null);

  // The meeting is "empty" until the first edit lands or the user
  // begins typing — that's the window in which they're allowed to
  // (re)set scheduledStartAt via the bubble picker.
  const isEmpty = $derived(bounds.first === null);

  function fmt(iso: string): string {
    const d = new Date(iso);
    return d
      .toLocaleString(LOCALE, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(",", "");
  }

  // The trigger label uses the same formatter as the read-only timestamp
  // so the on-click affordance reads identically to its post-edit form.
  const triggerLabel = $derived(
    scheduledStartAt
      ? fmt(scheduledStartAt)
      : createdAt
        ? fmt(createdAt)
        : "",
  );

  let bubbleOpen = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();

  function toggleBubble(): void {
    bubbleOpen = !bubbleOpen;
  }
  function closeBubble(): void {
    bubbleOpen = false;
  }
  function handleCommit(iso: string): void {
    store.setScheduledStartAt(iso);
    bubbleOpen = false;
  }
  function handleClear(): void {
    store.clearScheduledStartAt();
    bubbleOpen = false;
  }

  // Clicks anywhere outside the bubble (and the trigger that opens it)
  // dismiss it. Listening on `mousedown` rather than `click` so the
  // dismissal happens before any inadvertent focus-shifting click
  // handlers on the underlying surface fire.
  $effect(() => {
    if (!bubbleOpen) return;
    function onDown(e: MouseEvent): void {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerEl?.contains(target)) return;
      const bubble = document.querySelector(".datetime-bubble");
      if (bubble?.contains(target)) return;
      bubbleOpen = false;
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  // Bubble takes the live scheduled value if set, else the createdAt as
  // a sensible starting point. Never read directly from the trigger
  // label — that's locale-formatted, not a parseable instant.
  const bubbleValue = $derived(scheduledStartAt ?? createdAt ?? "");
</script>

{#if isEmpty && createdAt}
  <div
    class="meeting-meta"
    aria-label={scheduledStartAt ? "Scheduled to start" : "Set scheduled start"}
  >
    {#if scheduledStartAt}
      <span class="scheduled-icon" aria-hidden="true">
        <CalendarClock size={13} strokeWidth={2} />
      </span>
    {/if}
    <button
      bind:this={triggerEl}
      class="ts-trigger"
      type="button"
      aria-label={scheduledStartAt
        ? "Change scheduled start"
        : "Set scheduled start"}
      aria-expanded={bubbleOpen}
      onclick={toggleBubble}
    >{triggerLabel}</button>
    {#if bubbleOpen && bubbleValue}
      <DateTimeBubble
        value={bubbleValue}
        hasSchedule={!!scheduledStartAt}
        onCommit={handleCommit}
        onClose={closeBubble}
        onClear={handleClear}
      />
    {/if}
  </div>
{:else if startTs}
  <div class="meeting-meta">
    <span class="ts">{fmt(startTs)}</span>
    {#if phase !== "none"}
      <span class="arrow" aria-hidden="true">→</span>
      {#if phase === "ended" && bounds.last}
        <span class="ts">{fmt(bounds.last)}</span>
      {:else}
        <span
          class="ellipsis"
          class:animated={phase === "live"}
          aria-label={phase === "live" ? "in progress" : "paused"}
        >
          <span class="dot">.</span><span class="dot">.</span><span class="dot"
            >.</span>
        </span>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .meeting-meta {
    /* Anchors the bubble's absolutely-positioned dropdown. */
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 16px;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
  .ts {
    font-variant-numeric: tabular-nums;
  }
  /* Editable trigger: visually a piece of inline text with the same
     dashed-underline editable affordance used by MeetingName, but
     keyboard-activatable as a button so screen readers and tab-order
     do the right thing. */
  .ts-trigger {
    all: unset;
    font: inherit;
    color: inherit;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    text-decoration: underline dashed
      color-mix(in srgb, var(--muted) 70%, transparent);
    text-underline-offset: 0.18em;
    text-decoration-thickness: 1px;
    transition: text-decoration-color 120ms ease;
  }
  .ts-trigger:hover,
  .ts-trigger:focus-visible {
    text-decoration-color: var(--accent);
    color: var(--accent);
  }
  .scheduled-icon {
    display: inline-flex;
    align-items: center;
    color: color-mix(in srgb, var(--muted) 80%, transparent);
  }
  .arrow {
    color: color-mix(in srgb, var(--muted) 70%, transparent);
  }
  .ellipsis {
    display: inline-flex;
    font-variant-numeric: tabular-nums;
    letter-spacing: 1px;
  }
  /* Static phase: dots sit at full strength. */
  .ellipsis .dot {
    opacity: 1;
  }
  /* Animated phase: each dot pulses in turn for a "thinking" feel. */
  .ellipsis.animated .dot {
    opacity: 0.3;
    animation: ellipsisPulse 1.4s infinite ease-in-out both;
  }
  .ellipsis.animated .dot:nth-child(2) {
    animation-delay: 0.2s;
  }
  .ellipsis.animated .dot:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes ellipsisPulse {
    0%,
    80%,
    100% {
      opacity: 0.3;
    }
    40% {
      opacity: 1;
    }
  }
</style>
