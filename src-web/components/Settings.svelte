<script lang="ts">
  import { untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getVersion } from "@tauri-apps/api/app";
  import { check, type Update } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
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
  import { loadConfig, saveConfig } from "../lib/config";
  import { isNative } from "../lib/platform";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import SunMoon from "@lucide/svelte/icons/sun-moon";
  import Bot from "@lucide/svelte/icons/bot";
  import BotOff from "@lucide/svelte/icons/bot-off";
  import BotMessageSquare from "@lucide/svelte/icons/bot-message-square";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";

  let theme = $state<Theme>(loadTheme());
  let paragraphGap = $state(loadParagraphGap());
  let mcpEnabled = $state(true);
  let mcpInstalled = $state(false);
  let installBusy = $state(false);
  let installError = $state<string | null>(null);
  let version = $state<string | null>(null);
  // Disables the MCP buttons until loadConfig resolves. Without this, a
  // user clicking before the async load finishes would have the optimistic
  // defaults (mcpEnabled=true, mcpInstalled=false) baked into saveConfig's
  // `{...}` object literal — silently re-enabling an explicitly-disabled
  // server, or wiping the sticky install marker.
  let configLoaded = $state(false);

  // Updater state machine:
  //   idle        — no check yet, or last check found nothing
  //   checking    — check() in flight
  //   downloading — update found, bytes streaming
  //   ready       — downloaded, awaiting user-triggered install + relaunch
  //   restarting  — install + relaunch in flight (button disabled)
  type UpdateState =
    | "idle"
    | "checking"
    | "downloading"
    | "ready"
    | "restarting";
  let updateState = $state<UpdateState>("idle");
  let pendingUpdate: Update | null = null;
  let pendingVersion = $state<string | null>(null);
  // True only when there is an in-flight check the user is watching —
  // either they clicked the button, or they clicked it after a silent
  // background check had already started. Spinner visibility hangs off
  // this flag so background activity stays invisible.
  let userInitiatedCheck = $state(false);

  // Pull persisted config once on mount. Fail-open defaults mean a fresh
  // install or a missing config file lands on "enabled" + "never installed"
  // without surfacing an error.
  $effect(() => {
    void loadConfig().then((c) => {
      mcpEnabled = c.mcpEnabled;
      mcpInstalled = c.mcpInstalled;
      configLoaded = true;
    });
    if (isNative) {
      void getVersion()
        .then((v) => {
          version = v;
        })
        .catch(() => {
          // Web builds and any unexpected failure just hide the version
          // line — it's a footnote, not load-bearing.
        });
      // Background auto-check on every Settings mount. Cheap and
      // silent — `userInitiatedCheck` stays false, so the spinner
      // doesn't show. Wrapped in untrack because runUpdateCheck()
      // synchronously reads updateState — without it, Svelte tracks
      // that read as a dependency and the catch handler's "back to
      // idle" assignment re-fires the effect, looping forever.
      untrack(() => {
        void runUpdateCheck();
      });
    }
  });

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

  // Single entry point for both the auto-check on mount and the manual
  // "Check for updates" button click. The plugin's per-call `timeout`
  // bounds a stalled GitHub fetch so the spinner can't hang forever
  // (corporate proxy, TLS stall, network drop). Any error drops us
  // back to `idle` and surfaces in the console for diagnosis.
  const CHECK_TIMEOUT_MS = 30_000;
  const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
  // A fast cache hit can return in <100ms, which makes the spinner
  // strobe rather than spin. Floor the animation at MIN_SPIN_MS so
  // there's always at least half a turn visible.
  const MIN_SPIN_MS = 500;
  async function runUpdateCheck(): Promise<void> {
    if (!isNative) return;
    if (updateState !== "idle") return;
    updateState = "checking";
    const minSpin = new Promise<void>((r) => setTimeout(r, MIN_SPIN_MS));
    try {
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (userInitiatedCheck) await minSpin;
      if (!update) {
        updateState = "idle";
        return;
      }
      pendingUpdate = update;
      pendingVersion = update.version;
      updateState = "downloading";
      await update.download(undefined, { timeout: DOWNLOAD_TIMEOUT_MS });
      updateState = "ready";
    } catch (e) {
      if (userInitiatedCheck) await minSpin;
      console.error("[oatpad updater]", e);
      updateState = "idle";
      pendingUpdate = null;
      pendingVersion = null;
    } finally {
      // The spinner only matters while the activity is visible.
      // Resetting here covers both "user clicked, check finished" and
      // "user joined a bg check that then finished".
      userInitiatedCheck = false;
    }
  }

  async function restartToUpdate(): Promise<void> {
    if (!pendingUpdate) return;
    updateState = "restarting";
    try {
      await pendingUpdate.install();
      await relaunch();
    } catch {
      // Install failed; back to "ready" so the user can retry. The
      // downloaded bundle is still cached by the plugin.
      updateState = "ready";
    }
  }

  function onUpdateButtonClick(): void {
    if (updateState === "ready") {
      void restartToUpdate();
      return;
    }
    // Either start a fresh check, or just promote an in-flight
    // background check to a visible one (so the spinner appears from
    // here on out without spawning a duplicate request).
    userInitiatedCheck = true;
    if (updateState === "idle") {
      void runUpdateCheck();
    }
  }

  // Spinner only animates when the user is watching — background
  // auto-checks stay invisible.
  const spinning = $derived(
    userInitiatedCheck &&
      (updateState === "checking" || updateState === "downloading"),
  );
  // Disable the button when there's user-visible activity (avoid
  // double-clicks) or while restart is in flight.
  const updateBusy = $derived(spinning || updateState === "restarting");
  const updateLabel = $derived(
    updateState === "ready" ? "Restart to update" : "Check for updates",
  );
  const updateTitle = $derived(
    updateState === "ready"
      ? `Restart to install v${pendingVersion}`
      : updateState === "restarting"
        ? "Restarting…"
        : spinning && updateState === "downloading"
          ? "Downloading update…"
          : spinning
            ? "Checking…"
            : "Check for updates",
  );

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
  <div class="row">
    <span class="label">MCP server</span>
    <div class="mcp-actions">
      <button
        class="mcp-btn"
        class:active={mcpInstalled}
        onclick={installMcp}
        aria-label={installLabel}
        title={installTitle}
        disabled={installBusy || !configLoaded}
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
        disabled={!configLoaded}
      >
        {#if mcpEnabled}
          <Bot size={16} strokeWidth={2} />
        {:else}
          <BotOff size={16} strokeWidth={2} />
        {/if}
      </button>
    </div>
  </div>
  {#if version}
    <div class="version-row">
      <span
        class="version"
        class:available={updateState === "ready" && pendingVersion}
        aria-label="Oatpad version"
      >
        {#if updateState === "ready" && pendingVersion}
          v{pendingVersion} available!
        {:else}
          v{version}
        {/if}
      </span>
      {#if isNative}
        <button
          class="update-btn"
          class:active={updateState === "ready"}
          onclick={onUpdateButtonClick}
          aria-label={updateLabel}
          title={updateTitle}
          disabled={updateBusy}
        >
          {#if updateState === "ready"}
            <RotateCw size={16} strokeWidth={2} />
          {:else}
            <span class="icon-wrap" class:spin={spinning}>
              <RefreshCw size={16} strokeWidth={2} />
            </span>
          {/if}
        </button>
      {/if}
    </div>
  {/if}
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
  .mcp-btn,
  .update-btn {
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
  .mcp-btn:hover,
  .update-btn:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .theme-btn:focus-visible,
  .mcp-btn:focus-visible,
  .update-btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
  .theme-btn.active,
  .mcp-btn.active,
  .update-btn.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .mcp-btn[disabled],
  .update-btn[disabled] {
    opacity: 0.5;
    cursor: default;
  }
  .icon-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon-wrap.spin {
    animation: oatpad-update-spin 1s linear infinite;
  }
  @keyframes oatpad-update-spin {
    to {
      transform: rotate(360deg);
    }
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
  /* Version + updater button share a footer-style row: separator above,
     extra padding to set it apart from the regular Theme/Gap/MCP rows. */
  .version-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 6px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, var(--fg) 12%, transparent);
  }
  .version {
    font-size: 11px;
    color: color-mix(in srgb, var(--fg) 45%, transparent);
    font-variant-numeric: tabular-nums;
    user-select: text;
  }
  .version.available {
    color: var(--accent);
    font-weight: 600;
  }
</style>
