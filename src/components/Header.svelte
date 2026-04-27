<script lang="ts">
  import * as store from "../lib/store.svelte";
  import { isNative, isWeb } from "../lib/platform";
  import ThemeToggle from "./ThemeToggle.svelte";
  import MeetingMeta from "./MeetingMeta.svelte";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Save from "@lucide/svelte/icons/save";
  import Search from "@lucide/svelte/icons/search";
  import PanelLeftOpen from "@lucide/svelte/icons/panel-left-open";
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";

  type Props = {
    onnew: () => void;
    onopen: () => void;
    onsave: () => void;
    sidebarCollapsed?: boolean;
    sidebarWidth?: number;
    ontogglesidebar?: () => void;
    searchOpen?: boolean;
    ontogglesearch?: () => void;
  };
  let {
    onnew,
    onopen,
    onsave,
    sidebarCollapsed = false,
    sidebarWidth = 240,
    ontogglesidebar,
    searchOpen = false,
    ontogglesearch,
  }: Props = $props();

  let draft = $state(store.state.notetaker);
  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    const n = store.state.notetaker;
    if (n !== draft && document.activeElement !== inputEl) {
      draft = n;
    }
  });

  function commitName(): void {
    const trimmed = draft.trim();
    draft = trimmed;
    store.setNotetaker(trimmed);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      inputEl?.blur();
    } else if (e.key === "Escape") {
      draft = store.state.notetaker;
      inputEl?.blur();
    }
  }

  function handleFocus(): void {
    inputEl?.select();
  }

  // Track collapse transitions so we can run a mirrored wobble animation
  // when the sidebar closes. (CSS animations only fire on class-add, not on
  // class-removal, so we add a transient `collapsing` flag for the duration
  // of the animation.)
  let prevExpanded: boolean | null = null;
  let collapsing = $state(false);
  let collapsingTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const expanded = !sidebarCollapsed;
    if (prevExpanded === null) {
      prevExpanded = expanded;
      return;
    }
    if (expanded !== prevExpanded) {
      if (!expanded) {
        collapsing = true;
        if (collapsingTimer) clearTimeout(collapsingTimer);
        collapsingTimer = setTimeout(() => {
          collapsing = false;
        }, 420);
      } else if (collapsingTimer) {
        clearTimeout(collapsingTimer);
        collapsingTimer = null;
        collapsing = false;
      }
      prevExpanded = expanded;
    }
  });
</script>

<header>
  {#if isNative}
    <div
      class="left-col"
      class:expanded={!sidebarCollapsed}
      style:--expanded-width="{sidebarWidth}px"
    >
      <div
        class="icon-tray"
        class:bouncing-in={!sidebarCollapsed}
        class:bouncing-out={collapsing}
      >
        <div class="expanded-icons">
          <span class="wobble theme-slot"><ThemeToggle /></span>
          <button
            class="icon-btn wobble search-slot"
            class:active={searchOpen}
            onclick={ontogglesearch}
            aria-label="Search meetings"
            aria-expanded={searchOpen}
            title="Search meetings"
          >
            <Search size={18} strokeWidth={2} />
          </button>
          <button
            class="icon-btn wobble new-slot"
            onclick={onnew}
            aria-label="New meeting"
            title="New meeting"
          >
            <CalendarPlus size={18} strokeWidth={2} />
          </button>
        </div>
        <button
          class="icon-btn wobble toggle-slot"
          onclick={ontogglesidebar}
          aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
          title={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
        >
          {#if sidebarCollapsed}
            <PanelLeftOpen size={18} strokeWidth={2} />
          {:else}
            <PanelLeftClose size={18} strokeWidth={2} />
          {/if}
        </button>
      </div>
    </div>
    <MeetingMeta />
    <div class="spacer" data-tauri-drag-region></div>
    <h1 class="title"
      ><input
        bind:this={inputEl}
        bind:value={draft}
        class="name-input"
        placeholder="Your name"
        onkeydown={handleKeydown}
        onfocus={handleFocus}
        onblur={commitName}
      /><span class="suffix">'s </span><span class="oat-word">oat</span><span
        class="pad">pad</span>
    </h1>
  {:else}
    <h1 class="title"
      ><input
        bind:this={inputEl}
        bind:value={draft}
        class="name-input"
        placeholder="Your name"
        onkeydown={handleKeydown}
        onfocus={handleFocus}
        onblur={commitName}
      /><span class="suffix">'s </span><span class="oat-word">oat</span><span
        class="pad">pad</span>
    </h1>
    <div class="spacer"></div>
    <div class="actions">
      <ThemeToggle />
      <button
        class="icon-btn"
        onclick={onnew}
        aria-label="New meeting"
        title="New meeting"
      >
        <CalendarPlus size={18} strokeWidth={2} />
      </button>
      <button
        class="icon-btn"
        onclick={onopen}
        aria-label="Open file"
        title="Open file"
      >
        <FolderOpen size={18} strokeWidth={2} />
      </button>
      <button
        class="icon-btn"
        onclick={onsave}
        aria-label="Save file"
        title="Save file"
      >
        <Save size={18} strokeWidth={2} />
      </button>
    </div>
  {/if}
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--surface);
    min-height: 52px;
  }
  /* Web-mode lateral padding (native applies its own via left-col / title). */
  header :global(.title) {
    padding: 10px 16px 10px 0;
  }
  :global(html:not(.native)) header {
    padding: 0 16px;
  }
  :global(html:not(.native)) header :global(.title) {
    padding: 10px 0;
  }

  .left-col {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 10px 12px 10px 92px;
    background: var(--surface);
    box-sizing: border-box;
    transition:
      width 180ms ease,
      background-color 180ms ease;
    width: 136px;
    align-self: stretch;
    overflow: hidden;
  }
  .left-col.expanded {
    width: var(--expanded-width, 240px);
    background: var(--bg);
  }
  /* During resize drag, the width is being updated continuously via JS;
     suppress the transition so the header doesn't chase the sidebar. */
  :global(html.resizing) .left-col {
    transition: none;
  }
  .expanded-icons {
    display: flex;
    gap: 4px;
    overflow: hidden;
    width: 0;
    margin: 0;
    opacity: 0;
    pointer-events: none;
    transition:
      width 180ms ease,
      margin 180ms ease,
      opacity 180ms ease;
  }
  .left-col.expanded .expanded-icons {
    width: 104px;
    margin-right: 4px;
    opacity: 1;
    pointer-events: auto;
  }

  .title {
    margin: 0;
    padding: 10px 16px 10px 0;
    font-family:
      "Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica,
      Arial, sans-serif;
    font-size: 20px;
    font-weight: 600;
    color: var(--accent);
    line-height: 1;
    white-space: nowrap;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .suffix,
  .oat-word,
  .pad {
    white-space: pre;
  }
  .oat-word {
    margin-left: 0.3em;
  }
  .pad {
    margin-left: 0.05em;
  }
  .name-input {
    all: unset;
    min-width: 1ch;
    field-sizing: content;
    cursor: text;
    /* Reserve the underline slot but hide it — see state rules below. */
    text-decoration: underline dashed transparent;
    text-underline-offset: 0.18em;
    text-decoration-thickness: 1px;
    transition: text-decoration-color 120ms ease;
  }
  /* Empty (placeholder showing): muted underline hints it's editable. */
  .name-input:placeholder-shown {
    text-decoration-color: var(--muted);
  }
  /* Hover always shows the accent underline, whether set or unset. */
  .name-input:hover:not(:focus) {
    text-decoration-color: var(--accent);
  }
  .name-input::placeholder {
    color: var(--muted);
    opacity: 1;
  }
  .spacer {
    flex: 1;
    align-self: stretch;
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    width: 32px;
    height: 32px;
    color: var(--icon);
  }
  .icon-btn:hover,
  .icon-btn.active {
    color: var(--icon-active);
  }
  .icon-tray {
    display: flex;
    align-items: center;
  }
  .theme-slot {
    display: inline-flex;
    align-items: center;
    --amp: 3px;
  }
  .search-slot {
    --amp: 3.5px;
  }
  .new-slot {
    --amp: 4px;
  }
  .toggle-slot {
    --amp: 5px;
  }
  /* Peak at 43% (~180ms — exactly when the drawer's 180ms width transition
     settles), so the lateral motion is continuous through the handoff. After
     the peak, two damped oscillations carry the icons back to rest. Per-
     segment easing uses cubic-bezier(0.4, 0, 0.6, 1), a sine-like S-curve
     that feels more pendulum than spring.

     Direction is driven by the `--dir` custom property: +1 for expand
     (overshoot right), -1 for collapse (overshoot left). */
  .icon-tray.bouncing-in .wobble,
  .icon-tray.bouncing-out .wobble {
    animation: trayWobble 420ms linear;
  }
  .icon-tray.bouncing-in .wobble {
    --dir: 1;
  }
  /* Collapse uses the same shape and timing as expand, but at 55%
     amplitude — a quieter handshake on the way out. */
  .icon-tray.bouncing-out .wobble {
    --dir: -0.55;
  }
  @keyframes trayWobble {
    0% {
      transform: translateX(0);
      animation-timing-function: ease-out;
    }
    43% {
      transform: translateX(calc(var(--amp, 8px) * var(--dir, 1)));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    66% {
      transform: translateX(calc(var(--amp, 8px) * var(--dir, 1) * -0.32));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    84% {
      transform: translateX(calc(var(--amp, 8px) * var(--dir, 1) * 0.2));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    100% {
      transform: translateX(0);
    }
  }
</style>
