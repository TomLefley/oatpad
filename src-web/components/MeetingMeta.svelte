<script lang="ts">
  import * as store from "../lib/store.svelte";
  import { editBounds, phaseFor, type Phase } from "../lib/meetingPhase";
  import { LOCALE } from "../lib/locale";
  import Clock from "@lucide/svelte/icons/clock";

  const createdAt = $derived(store.state.meeting?.createdAt);
  const scheduledStartAt = $derived(store.state.meeting?.scheduledStartAt);

  const bounds = $derived(
    editBounds(
      store.state.meeting?.events ?? [],
      store.state.firstInputAt,
      store.state.lastInputAt,
    ),
  );

  // "Scheduled but not started" = a planned start time exists and the
  // user hasn't typed anything yet (no edit events, no live input).
  // Once anything makes bounds.first non-null we drop back into the
  // regular start→phase indicator UI.
  const scheduledOnly = $derived(
    !!scheduledStartAt && bounds.first === null,
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
</script>

{#if scheduledOnly && scheduledStartAt}
  <div class="meeting-meta" aria-label="Scheduled to start">
    <span class="scheduled-icon" aria-hidden="true">
      <Clock size={13} strokeWidth={2} />
    </span>
    <span class="ts">{fmt(scheduledStartAt)}</span>
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
