<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { check, type Update } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { isNative } from "../lib/platform";
  import {
    UpdaterMachine,
    type UpdateHandle,
  } from "../lib/updater.svelte";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";

  let version = $state<string | null>(null);

  // Wrap the Tauri plugin's check() into the UpdaterMachine's UpdateHandle
  // shape — the machine doesn't know about Tauri, only about the trio of
  // operations (download, install) it needs.
  function tauriCheck(timeoutMs: number): Promise<UpdateHandle | null> {
    return check({ timeout: timeoutMs }).then((u: Update | null) =>
      u
        ? {
            version: u.version,
            download: (t: number) => u.download(undefined, { timeout: t }),
            install: () => u.install(),
          }
        : null,
    );
  }

  const machine = new UpdaterMachine(
    {
      check: tauriCheck,
      relaunch,
      delay: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
      log: (msg, err) => console.error(msg, err),
    },
    {
      checkTimeoutMs: 30_000,
      downloadTimeoutMs: 5 * 60_000,
      minSpinMs: 500,
    },
  );

  // The `initialized` flag pins this to a single mount-time run.
  // runCheck() reads and writes machine.state, so a naive $effect would
  // track that and re-fire on every transition.
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
    // userInitiatedCheck stays false, so the spinner doesn't show.
    void machine.runCheck();
  });

  const updateLabel = $derived(
    machine.state === "ready" ? "Restart to update" : "Check for updates",
  );
  const updateTitle = $derived(
    machine.state === "ready"
      ? `Restart to install v${machine.pendingVersion}`
      : machine.state === "restarting"
        ? "Restarting…"
        : machine.spinning && machine.state === "downloading"
          ? "Downloading update…"
          : machine.spinning
            ? "Checking…"
            : "Check for updates",
  );
</script>

{#if version}
  <div class="version-row">
    <span
      class="version"
      class:available={machine.state === "ready" && machine.pendingVersion}
      aria-label="Oatpad version"
    >
      {#if machine.state === "ready" && machine.pendingVersion}
        v{machine.pendingVersion} available!
      {:else}
        v{version}
      {/if}
    </span>
    {#if isNative}
      <button
        class="update-btn"
        class:active={machine.state === "ready"}
        onclick={() => machine.click()}
        aria-label={updateLabel}
        title={updateTitle}
        disabled={machine.busy}
      >
        {#if machine.state === "ready"}
          <RotateCw size={16} strokeWidth={2} />
        {:else}
          <span class="icon-wrap" class:spin={machine.spinning}>
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
