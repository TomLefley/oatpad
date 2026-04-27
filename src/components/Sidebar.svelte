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

  // For sessions started today show the time; for older sessions show the
  // date. Keeps the column narrow whatever the row's age.
  function fmtTimestamp(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return d
      .toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
      })
      .replace(",", "");
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
          <!-- The row-main button already provides keyboard access; this
               div is a mouse-only secondary affordance so the timestamp
               column is also clickable. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="row-right" onclick={() => onswitch(meta.sessionId)}>
            <span class="row-time">{fmtTimestamp(meta.createdAt)}</span>
            <button
              class="row-del"
              onclick={(e) => {
                e.stopPropagation();
                handleDelete(meta.sessionId, label);
              }}
              aria-label="Delete meeting"
              title="Delete meeting"
            >
              <Trash2 size={14} strokeWidth={2} />
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
  .row-right:focus-within .row-time {
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
      transform 160ms ease;
  }
  .row-right:hover .row-del,
  .row-right:focus-within .row-del {
    opacity: 1;
    transform: translate(0, -50%);
  }
  .row-del:hover {
    color: var(--icon-active);
  }
</style>
