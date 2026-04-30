<script lang="ts">
  import {
    loadTheme,
    saveTheme,
    applyTheme,
    type Theme,
  } from "../lib/theme";
  import {
    loadParagraphGap,
    saveParagraphGap,
    applyParagraphGap,
    PARAGRAPH_GAP_MIN,
    PARAGRAPH_GAP_MAX,
    PARAGRAPH_GAP_STEP,
  } from "../lib/paragraphGap";
  import McpRow from "./McpRow.svelte";
  import UpdaterRow from "./UpdaterRow.svelte";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import SunMoon from "@lucide/svelte/icons/sun-moon";

  let theme = $state<Theme>(loadTheme());
  let paragraphGap = $state(loadParagraphGap());

  function pickTheme(next: Theme): void {
    if (next === theme) return;
    theme = next;
    saveTheme(next);
    applyTheme(next);
  }

  function setParagraphGap(next: number): void {
    paragraphGap = next;
    applyParagraphGap(next);
    saveParagraphGap(next);
  }
</script>

<div class="settings">
  <div class="row">
    <span class="label">Theme</span>
    <div class="theme-picker" role="radiogroup" aria-label="Theme">
      <button
        class="theme-btn"
        class:active={theme === "system"}
        onclick={() => pickTheme("system")}
        role="radio"
        aria-checked={theme === "system"}
        aria-label="System theme"
        title="System"
      >
        <SunMoon size={16} strokeWidth={2} />
      </button>
      <button
        class="theme-btn"
        class:active={theme === "light"}
        onclick={() => pickTheme("light")}
        role="radio"
        aria-checked={theme === "light"}
        aria-label="Light theme"
        title="Light"
      >
        <Sun size={16} strokeWidth={2} />
      </button>
      <button
        class="theme-btn"
        class:active={theme === "dark"}
        onclick={() => pickTheme("dark")}
        role="radio"
        aria-checked={theme === "dark"}
        aria-label="Dark theme"
        title="Dark"
      >
        <Moon size={16} strokeWidth={2} />
      </button>
    </div>
  </div>
  <div class="row">
    <span class="label">Paragraph gap</span>
    <input
      class="gap-slider"
      type="range"
      min={PARAGRAPH_GAP_MIN}
      max={PARAGRAPH_GAP_MAX}
      step={PARAGRAPH_GAP_STEP}
      value={paragraphGap}
      oninput={(e) => setParagraphGap(Number(e.currentTarget.value))}
      aria-label="Space between paragraphs"
      title="{paragraphGap.toFixed(3).replace(/\.?0+$/, '')}em"
    />
  </div>
  <McpRow />
  <UpdaterRow />
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 2px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .label {
    font-size: 12px;
    color: color-mix(in srgb, var(--fg) 75%, transparent);
    user-select: none;
  }
  .theme-picker {
    display: inline-flex;
    gap: 2px;
  }
  .theme-btn {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: color-mix(in srgb, var(--fg) 60%, transparent);
    cursor: pointer;
    transition:
      color 120ms ease,
      background-color 120ms ease;
  }
  .theme-btn:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .theme-btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
  .theme-btn.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  /* Slim slider styled to sit alongside the icon-button rows. The
     `appearance: none` baseline strips Chrome/Safari/Firefox's chrome
     so the track and thumb can be themed with the same accent palette
     as the rest of the bubble. Width matches the three-icon themes
     row above (3 × 26 + 2 × 2 gap = 82px) so the controls align
     vertically. */
  .gap-slider {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    width: 82px;
    height: 18px;
    margin: 0;
    padding: 0;
    cursor: pointer;
  }
  .gap-slider::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--fg) 18%, transparent);
  }
  .gap-slider::-moz-range-track {
    height: 3px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--fg) 18%, transparent);
    border: none;
  }
  .gap-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    border: none;
    margin-top: -4.5px;
    transition: transform 120ms ease;
  }
  .gap-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    border: none;
    transition: transform 120ms ease;
  }
  .gap-slider:hover::-webkit-slider-thumb,
  .gap-slider:focus-visible::-webkit-slider-thumb {
    transform: scale(1.15);
  }
  .gap-slider:hover::-moz-range-thumb,
  .gap-slider:focus-visible::-moz-range-thumb {
    transform: scale(1.15);
  }
  .gap-slider:focus-visible {
    outline: none;
  }
</style>
