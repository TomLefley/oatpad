<script lang="ts">
  import * as store from "../lib/store.svelte";
  import { slide, scale } from "svelte/transition";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  type Props = {
    collapsed: boolean;
    width: number;
    onswitch: (id: string) => void;
    searchOpen?: boolean;
    oncloseSearch?: () => void;
  };
  let {
    collapsed,
    width,
    onswitch,
    searchOpen = false,
    oncloseSearch,
  }: Props = $props();

  let searchQuery = $state("");
  let searchInputEl: HTMLInputElement | undefined = $state();
  // The input is hidden until the bubble's pop animation completes — it's
  // mounted from t=0 but the input's native rendering (border/caret/etc.)
  // can briefly peek through the scaling bubble, which reads as a square
  // flash. Holding it back until the pop settles makes the entrance feel
  // staged: bubble first, contents after.
  let inputVisible = $state(false);
  $effect(() => {
    if (!searchOpen) inputVisible = false;
  });

  function labelFor(title: string): string {
    return title.trim() || "meeting";
  }

  const filteredSessions = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return store.state.sessions;
    return store.state.sessions.filter((m) =>
      labelFor(m.title).toLowerCase().includes(q),
    );
  });

  function handleSearchKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      oncloseSearch?.();
    }
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
    {#if searchOpen}
      <!-- Spacer holds the layout space and animates its height via slide.
           It has no content, so the slide's overflow:hidden has nothing to
           clip — that's why it's a separate element from the bubble. -->
      <div class="search-spacer" transition:slide={{ duration: 100 }}></div>
      <!-- Bubble lives in an absolutely-positioned anchor over the spacer
           area, so it can render with rounded ends regardless of the
           spacer's height during the slide. -->
      <div class="search-bubble-anchor">
        <div
          class="search-bubble"
          out:scale={{ duration: 100 }}
          onanimationend={() => {
            inputVisible = true;
            searchInputEl?.focus();
          }}
        >
          <span class="search-arrow" aria-hidden="true"></span>
          <div class="search-body">
            <input
              bind:this={searchInputEl}
              bind:value={searchQuery}
              class="search-input"
              class:visible={inputVisible}
              type="text"
              placeholder="Search meetings"
              onkeydown={handleSearchKeydown}
            />
          </div>
        </div>
      </div>
    {/if}
    <ul class="list">
      {#each filteredSessions as meta (meta.sessionId)}
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
  /* Spacer's fixed height matches the bubble's natural box (38px bubble +
     4px breathing room beneath). Animating this between 0 and 42 with the
     slide transition is what makes the list slide down/up smoothly. */
  .search-spacer {
    height: 42px;
    flex-shrink: 0;
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
       The 50ms delay lets the spacer's slide finish first, so the bubble
       only becomes visible once there's space for it. */
    animation: pop-in 200ms cubic-bezier(0.34, 1.56, 0.64, 1) 50ms backwards;
  }
  @keyframes pop-in {
    0% {
      transform: scale(0.7);
      opacity: 0;
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
  .search-body {
    background: var(--bubble-bg);
    /* Fully pill-shaped — left and right ends are semicircles. The huge
       radius is clamped by the box's height, so this works at any size. */
    border-radius: 9999px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
    padding: 6px 14px;
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
    width: 100%;
    box-sizing: border-box;
    color: var(--fg);
    font-family: var(--font-sans);
    font-size: 13.5px;
    line-height: 1.5;
    opacity: 0;
    transition: opacity 80ms ease;
  }
  input.search-input.visible {
    opacity: 1;
  }
  input.search-input:focus {
    outline: none;
  }
  input.search-input::placeholder {
    color: color-mix(in srgb, var(--fg) 55%, transparent);
  }
</style>
