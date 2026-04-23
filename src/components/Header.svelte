<script lang="ts">
  import * as store from "../lib/store.svelte";
  import {
    loadTheme,
    saveTheme,
    applyTheme,
    cycleTheme,
    type Theme,
  } from "../lib/theme";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import Monitor from "@lucide/svelte/icons/monitor";
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Save from "@lucide/svelte/icons/save";

  type Props = {
    onnew: () => void;
    onopen: () => void;
    onsave: () => void;
  };
  let { onnew, onopen, onsave }: Props = $props();

  let draft = $state(store.state.notetaker);
  let inputEl: HTMLInputElement | undefined = $state();
  let theme = $state<Theme>(loadTheme());

  // Keep local draft aligned with the store when the user isn't actively editing.
  $effect(() => {
    const n = store.state.notetaker;
    if (n !== draft && document.activeElement !== inputEl) {
      draft = n;
    }
  });

  const themeLabel = $derived(
    theme === "system" ? "Auto" : theme === "light" ? "Light" : "Dark",
  );

  function toggleTheme(): void {
    theme = cycleTheme(theme);
    saveTheme(theme);
    applyTheme(theme);
  }

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
</script>

<header>
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
    <button
      class="icon-btn"
      onclick={toggleTheme}
      aria-label="Theme: {themeLabel}"
      title="Theme: {themeLabel} (click to cycle system → light → dark)"
    >
      {#if theme === "system"}
        <Monitor size={18} strokeWidth={2} />
      {:else if theme === "light"}
        <Sun size={18} strokeWidth={2} />
      {:else}
        <Moon size={18} strokeWidth={2} />
      {/if}
    </button>
    <button
      class="icon-btn"
      onclick={onnew}
      aria-label="New session"
      title="New session"
    >
      <FilePlus size={18} strokeWidth={2} />
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
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .title {
    margin: 0;
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
    text-decoration: underline dashed
      color-mix(in srgb, currentColor 30%, transparent);
    text-underline-offset: 0.18em;
    text-decoration-thickness: 1px;
    transition: text-decoration-color 120ms ease;
  }
  .name-input:hover:not(:focus) {
    text-decoration-color: currentColor;
  }
  .name-input:focus {
    text-decoration-color: transparent;
  }
  .name-input::placeholder {
    color: var(--muted);
    opacity: 1;
  }
  .spacer {
    flex: 1;
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
  .icon-btn:hover {
    color: var(--icon-active);
  }
</style>
