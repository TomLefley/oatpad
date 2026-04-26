<script lang="ts">
  import * as store from "../lib/store.svelte";
  import { slide } from "svelte/transition";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  type Props = {
    collapsed: boolean;
    width: number;
    onswitch: (id: string) => void;
  };
  let { collapsed, width, onswitch }: Props = $props();

  function labelFor(title: string): string {
    return title.trim() || "meeting";
  }

  async function handleDelete(id: string, label: string): Promise<void> {
    const ok = confirm(`Delete "${label}"? This can't be undone.`);
    if (!ok) return;
    await store.deleteSessionById(id);
  }
</script>

{#if !collapsed}
  <aside
    class="sidebar"
    style:width="{width}px"
    transition:slide={{ axis: "x", duration: 180 }}
  >
    <ul class="list">
      {#each store.state.sessions as meta (meta.sessionId)}
        {@const current = store.state.session?.sessionId === meta.sessionId}
        {@const label = labelFor(meta.title)}
        <li class="row" class:current>
          <button
            class="row-main"
            onclick={() => onswitch(meta.sessionId)}
            title={label}
          >
            <span class="row-label">{label}</span>
          </button>
          <button
            class="row-del"
            onclick={() => handleDelete(meta.sessionId, label)}
            aria-label="Delete session"
            title="Delete session"
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
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
  .row-del {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    color: var(--icon);
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .row:hover .row-del,
  .row:focus-within .row-del {
    opacity: 1;
  }
  .row-del:hover {
    color: var(--icon-active);
  }
</style>
