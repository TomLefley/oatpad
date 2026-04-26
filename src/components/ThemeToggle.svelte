<script lang="ts">
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

  let theme = $state<Theme>(loadTheme());

  const themeLabel = $derived(
    theme === "system" ? "Auto" : theme === "light" ? "Light" : "Dark",
  );

  function toggle(): void {
    theme = cycleTheme(theme);
    saveTheme(theme);
    applyTheme(theme);
  }
</script>

<button
  class="icon-btn"
  onclick={toggle}
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

<style>
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
