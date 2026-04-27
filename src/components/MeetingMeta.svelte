<script lang="ts">
  import * as store from "../lib/store.svelte";

  const createdAt = $derived(store.state.session?.createdAt);

  // First and latest *edits*, blending two sources:
  //   • Committed edit events (`note_created`/`note_edited`/`note_deleted`).
  //   • Live input markers from the store, bumped on every keystroke so the
  //     header reacts immediately rather than waiting for the editor's
  //     debounced commit (~3s after a keystroke / on block change).
  // Bookkeeping events (`session_started`, `file_loaded`) are excluded.
  const editBounds = $derived.by(() => {
    const events = store.state.session?.events ?? [];
    let first: string | null = null;
    let last: string | null = null;
    for (const e of events) {
      if (
        e.type === "note_created" ||
        e.type === "note_edited" ||
        e.type === "note_deleted"
      ) {
        if (!first || e.ts < first) first = e.ts;
        if (!last || e.ts > last) last = e.ts;
      }
    }
    const fi = store.state.firstInputAt;
    const li = store.state.lastInputAt;
    if (fi && (!first || fi < first)) first = fi;
    if (li && (!last || li > last)) last = li;
    return { first, last };
  });

  // Phase progression after the latest edit:
  //   <1m   → "live"   (animated ellipsis)
  //   1–3m  → "idle"   (static ellipsis)
  //   ≥3m   → "ended"  (real end timestamp)
  // No edits at all → "none" (only the start time is shown).
  type Phase = "none" | "live" | "idle" | "ended";
  let phase = $state<Phase>("none");

  // Self-driving chain: each timeout advances `phase` and schedules the next.
  // Re-runs whenever the latest edit changes (a new edit resets the clock).
  $effect(() => {
    const last = editBounds.last;
    if (!last) {
      phase = "none";
      return;
    }
    const lastMs = new Date(last).getTime();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = (): void => {
      const since = Date.now() - lastMs;
      if (since < 60_000) {
        phase = "live";
        timer = setTimeout(tick, 60_000 - since + 50);
      } else if (since < 180_000) {
        phase = "idle";
        timer = setTimeout(tick, 180_000 - since + 50);
      } else {
        phase = "ended";
      }
    };
    tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  });

  const startTs = $derived(editBounds.first ?? createdAt ?? null);

  function fmt(iso: string): string {
    const d = new Date(iso);
    return d
      .toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(",", "");
  }
</script>

{#if startTs}
  <div class="meeting-meta">
    <span class="ts">{fmt(startTs)}</span>
    {#if phase !== "none"}
      <span class="arrow" aria-hidden="true">→</span>
      {#if phase === "ended" && editBounds.last}
        <span class="ts">{fmt(editBounds.last)}</span>
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
