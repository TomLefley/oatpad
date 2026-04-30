<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { check, type Update } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { isNative } from "../lib/platform";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";

  let version = $state<string | null>(null);

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

  // The `initialized` flag pins the effect to a single run. runUpdateCheck()
  // reads and writes updateState, so a naive $effect would track that read
  // and re-fire when the catch handler resets to "idle" — looping forever.
  // Early-returning on the second fire drops the tracked dep and breaks the
  // cycle without relying on Svelte's untrack() semantics, which a future
  // maintainer might inadvertently undo.
  let initialized = false;
  $effect(() => {
    if (initialized) return;
    initialized = true;
    if (!isNative) return;
    void getVersion()
      .then((v) => {
        version = v;
      })
      .catch(() => {
        // Web builds and any unexpected failure just hide the version
        // line — it's a footnote, not load-bearing.
      });
    // Background auto-check on every mount. Cheap and silent —
    // `userInitiatedCheck` stays false, so the spinner doesn't show.
    void runUpdateCheck();
  });

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
    // Two awaits, two distinct failure modes: install can fail (bundle
    // corrupt, FS permission, plugin error) but if it succeeds the new
    // build is on disk and re-running install would either no-op or
    // double-write. Distinguish them so a relaunch failure doesn't
    // strand the user on a "Restart to update" button that would
    // attempt to install again.
    try {
      await pendingUpdate.install();
    } catch (e) {
      console.error("[oatpad updater] install failed", e);
      updateState = "ready";
      return;
    }
    try {
      await relaunch();
    } catch (e) {
      // Install succeeded — the next launch will already be the new
      // version. Drop the in-memory pendingUpdate so the button reverts
      // to "Check for updates" rather than re-prompting a restart.
      console.error("[oatpad updater] relaunch failed", e);
      pendingUpdate = null;
      pendingVersion = null;
      updateState = "idle";
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
</script>

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

<style>
  /* Version + updater button share a footer-style row: separator above,
     extra padding to set it apart from the regular settings rows. */
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
  .update-btn:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .update-btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
  .update-btn.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
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
</style>
