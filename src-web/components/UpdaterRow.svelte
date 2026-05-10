<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { isNative } from "../lib/platform";
  import { updater, versionState } from "../lib/updaterInstance.svelte";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Bug from "@lucide/svelte/icons/bug";
  import Milestone from "@lucide/svelte/icons/milestone";

  // The machine and the auto-check live in updaterInstance.svelte — that
  // way the header's "update ready" dot can read the machine's state even
  // before the settings bubble has ever been opened. This component is now
  // purely the rendering surface for the same singleton.

  // GitHub's template-chooser route lets the user pick a bug/feature
  // template instead of dropping them onto a blank issue body.
  const FEEDBACK_URL =
    "https://github.com/TomLefley/oatpad/issues/new/choose";
  const RELEASES_URL = "https://github.com/TomLefley/oatpad/releases";

  async function openExternal(url: string): Promise<void> {
    if (isNative) {
      try {
        await invoke("open_url", { url });
        return;
      } catch {
        // Fall through to window.open if the OS handler refuses —
        // better than dropping the click silently.
      }
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // The notes link only appears alongside the "vX.Y.Z available!"
  // notification, so it always points at the pending version's tag.
  const notesUrl = $derived(
    updater.pendingVersion
      ? `${RELEASES_URL}/tag/v${updater.pendingVersion}`
      : RELEASES_URL,
  );

  const restartTitle = $derived(
    updater.state === "restarting"
      ? "Restarting…"
      : `Restart to install v${updater.pendingVersion}`,
  );
  const checkTitle = $derived(
    updater.spinning && updater.state === "downloading"
      ? "Downloading update…"
      : updater.spinning
        ? "Checking…"
        : "Check for updates",
  );
</script>

{#if versionState.value}
  <div class="version-row">
    {#if updater.state === "ready" && updater.pendingVersion}
      <button
        class="restart-btn"
        onclick={() => updater.click()}
        aria-label={`Restart to install v${updater.pendingVersion}`}
        title={restartTitle}
        disabled={updater.busy}
      >
        <RotateCw size={16} strokeWidth={2} />
        <span class="version available">
          v{updater.pendingVersion} available!
        </span>
      </button>
    {:else}
      <span class="version" aria-label="Oatpad version">
        v{versionState.value}
      </span>
    {/if}
    <div class="footer-actions">
      {#if updater.state === "ready" && updater.pendingVersion}
        <button
          class="notes-btn"
          onclick={() => openExternal(notesUrl)}
          aria-label="View release notes on GitHub"
          title="View release notes on GitHub"
        >
          <Milestone size={16} strokeWidth={2} />
        </button>
      {:else if isNative}
        <button
          class="update-btn"
          onclick={() => updater.click()}
          aria-label="Check for updates"
          title={checkTitle}
          disabled={updater.busy}
        >
          <span class="icon-wrap" class:spin={updater.spinning}>
            <RefreshCw size={16} strokeWidth={2} />
          </span>
        </button>
      {/if}
      <button
        class="feedback-btn"
        onclick={() => openExternal(FEEDBACK_URL)}
        aria-label="Report a bug on GitHub"
        title="Report a bug on GitHub"
      >
        <Bug size={16} strokeWidth={2} />
      </button>
    </div>
  </div>
{/if}

<style>
  /* Version + updater button share a footer-style row: separator above,
     extra padding to set it apart from the regular settings rows. */
  .version-row {
    display: flex;
    align-items: center;
    gap: 8px;
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
    /* Inside the restart button text selection would compete with the
       click target, so don't let it become a drag handle. */
    user-select: none;
  }
  .footer-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    /* Pushes the action buttons to the right edge regardless of whether
       the leader is the plain version span or the wider restart button. */
    margin-left: auto;
  }
  .restart-btn {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 6px;
    /* Negative horizontal margin extends the hit area to the row's left
       edge so the click target lines up with the version span it replaces. */
    margin: 0 -6px;
    border-radius: 6px;
    color: var(--accent);
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  .restart-btn:hover {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .restart-btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
  .restart-btn[disabled] {
    opacity: 0.6;
    cursor: default;
  }
  .update-btn,
  .feedback-btn,
  .notes-btn {
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
  .update-btn:hover,
  .feedback-btn:hover,
  .notes-btn:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .update-btn:focus-visible,
  .feedback-btn:focus-visible,
  .notes-btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
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
