<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import {
    loadTheme,
    saveTheme,
    applyTheme,
    type Theme,
  } from "../lib/theme";
  import { loadConfig, saveConfig } from "../lib/config";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import SunMoon from "@lucide/svelte/icons/sun-moon";
  import Bot from "@lucide/svelte/icons/bot";
  import BotOff from "@lucide/svelte/icons/bot-off";
  import BotMessageSquare from "@lucide/svelte/icons/bot-message-square";

  let theme = $state<Theme>(loadTheme());
  let mcpEnabled = $state(true);
  let mcpInstalled = $state(false);
  let installBusy = $state(false);
  let installError = $state<string | null>(null);

  // Pull persisted config once on mount. Fail-open defaults mean a fresh
  // install or a missing config file lands on "enabled" + "never installed"
  // without surfacing an error.
  $effect(() => {
    void loadConfig().then((c) => {
      mcpEnabled = c.mcpEnabled;
      mcpInstalled = c.mcpInstalled;
    });
  });

  function pickTheme(next: Theme): void {
    if (next === theme) return;
    theme = next;
    saveTheme(next);
    applyTheme(next);
  }

  async function toggleMcp(): Promise<void> {
    const next = !mcpEnabled;
    mcpEnabled = next;
    try {
      await saveConfig({ mcpEnabled: next, mcpInstalled });
    } catch {
      // Roll back the optimistic flip if persistence fails — better to
      // mismatch the on-screen state for a moment than to lie about what
      // the MCP server will see on its next request.
      mcpEnabled = !next;
    }
  }

  async function installMcp(): Promise<void> {
    installBusy = true;
    installError = null;
    try {
      await invoke("install_mcpb");
      mcpInstalled = true;
      // Persist the install marker so subsequent launches show the
      // button as "Reinstall" / active. Tolerate save failure — the
      // OS handover already happened, the marker is just bookkeeping.
      try {
        await saveConfig({ mcpEnabled, mcpInstalled: true });
      } catch {}
    } catch (e) {
      installError = String(e);
    } finally {
      installBusy = false;
    }
  }

  const installLabel = $derived(
    mcpInstalled
      ? "Reinstall Oatpad's MCP server in Claude"
      : "Install Oatpad's MCP server in Claude",
  );
  const installTitle = $derived(
    installError
      ? `Install failed: ${installError}`
      : mcpInstalled
        ? "Reinstall in Claude Desktop"
        : "Install in Claude Desktop",
  );
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
    <span class="label">MCP server</span>
    <div class="mcp-actions">
      <button
        class="mcp-btn"
        class:active={mcpInstalled}
        onclick={installMcp}
        aria-label={installLabel}
        title={installTitle}
        disabled={installBusy}
      >
        <BotMessageSquare size={16} strokeWidth={2} />
      </button>
      <button
        class="mcp-btn"
        class:active={mcpEnabled}
        onclick={toggleMcp}
        role="switch"
        aria-checked={mcpEnabled}
        aria-label={mcpEnabled ? "Stop MCP server" : "Start MCP server"}
        title={mcpEnabled ? "Running" : "Stopped"}
      >
        {#if mcpEnabled}
          <Bot size={16} strokeWidth={2} />
        {:else}
          <BotOff size={16} strokeWidth={2} />
        {/if}
      </button>
    </div>
  </div>
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
  .theme-picker,
  .mcp-actions {
    display: inline-flex;
    gap: 2px;
  }
  .theme-btn,
  .mcp-btn {
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
  .theme-btn:hover,
  .mcp-btn:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .theme-btn:focus-visible,
  .mcp-btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
  .theme-btn.active,
  .mcp-btn.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .mcp-btn[disabled] {
    opacity: 0.5;
    cursor: progress;
  }
</style>
