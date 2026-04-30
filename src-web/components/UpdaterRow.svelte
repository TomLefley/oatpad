<script lang="ts">
  import { isNative } from "../lib/platform";
  import { updater, versionState } from "../lib/updaterInstance.svelte";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";

  // The machine and the auto-check live in updaterInstance.svelte — that
  // way the header's "update ready" dot can read the machine's state even
  // before the settings bubble has ever been opened. This component is now
  // purely the rendering surface for the same singleton.

  const updateLabel = $derived(
    updater.state === "ready" ? "Restart to update" : "Check for updates",
  );
  const updateTitle = $derived(
    updater.state === "ready"
      ? `Restart to install v${updater.pendingVersion}`
      : updater.state === "restarting"
        ? "Restarting…"
        : updater.spinning && updater.state === "downloading"
          ? "Downloading update…"
          : updater.spinning
            ? "Checking…"
            : "Check for updates",
  );
</script>

{#if versionState.value}
  <div class="version-row">
    <span
      class="version"
      class:available={updater.state === "ready" && updater.pendingVersion}
      aria-label="Oatpad version"
    >
      {#if updater.state === "ready" && updater.pendingVersion}
        v{updater.pendingVersion} available!
      {:else}
        v{versionState.value}
      {/if}
    </span>
    {#if isNative}
      <button
        class="update-btn"
        class:active={updater.state === "ready"}
        onclick={() => updater.click()}
        aria-label={updateLabel}
        title={updateTitle}
        disabled={updater.busy}
      >
        {#if updater.state === "ready"}
          <RotateCw size={16} strokeWidth={2} />
        {:else}
          <span class="icon-wrap" class:spin={updater.spinning}>
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
