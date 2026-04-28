<script lang="ts">
  import { isWeb } from "../lib/platform";
  import OatpadTitle from "./OatpadTitle.svelte";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import FolderOpen from "@lucide/svelte/icons/folder-open";

  type Props = {
    onnew: () => void;
    onopen: () => void;
  };
  let { onnew, onopen }: Props = $props();
</script>

<div class="getting-started">
  <OatpadTitle size="hero" />
  <p class="tagline">A tiny notepad for meetings</p>
  <div class="actions">
    <button class="primary" onclick={onnew}>
      <CalendarPlus size={18} strokeWidth={2} />
      <span>Start a new meeting</span>
    </button>
    {#if isWeb}
      <button class="secondary" onclick={onopen}>
        <FolderOpen size={18} strokeWidth={2} />
        <span>Open a file</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .getting-started {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 32px;
    background: var(--surface);
  }
  .tagline {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin-top: 12px;
  }
  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease,
      border-color 120ms ease;
  }
  .primary {
    background: var(--accent);
    color: var(--bg);
    font-weight: 500;
  }
  .primary:hover {
    background: color-mix(in srgb, var(--accent) 88%, var(--fg));
  }
  .secondary {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
  }
  .secondary:hover {
    background: var(--surface-hover);
    border-color: color-mix(in srgb, var(--border) 60%, var(--fg));
  }
  .primary:focus-visible,
  .secondary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
