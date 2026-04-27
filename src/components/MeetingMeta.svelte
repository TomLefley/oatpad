<script lang="ts">
  import * as store from "../lib/store.svelte";

  const createdAt = $derived(store.state.session?.createdAt);

  // Latest *edit* event — i.e. an actual note mutation, not the session
  // bookkeeping events (`session_started`, `file_loaded`).
  const latestEdit = $derived.by(() => {
    const events = store.state.session?.events ?? [];
    let latest: string | null = null;
    for (const e of events) {
      if (
        e.type === "note_created" ||
        e.type === "note_edited" ||
        e.type === "note_deleted"
      ) {
        if (!latest || e.ts > latest) latest = e.ts;
      }
    }
    return latest;
  });

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

{#if createdAt}
  <div class="meeting-meta">
    <span class="ts">{fmt(createdAt)}</span>
    {#if latestEdit}
      <span class="arrow" aria-hidden="true">→</span>
      <span class="ts">{fmt(latestEdit)}</span>
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
</style>
