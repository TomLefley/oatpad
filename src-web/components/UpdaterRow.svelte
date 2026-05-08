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

  // The notes button only shows alongside the "vX.Y.Z available!"
  // notification, so it always links to the pending version's tag.
  const notesUrl = $derived(
    updater.pendingVersion
      ? `${RELEASES_URL}/tag/v${updater.pendingVersion}`
      : RELEASES_URL,
  );

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
    {#if updater.state === "ready" && updater.pendingVersion}
      <button
        class="notes-btn"
        onclick={() => openExternal(notesUrl)}
        aria-label="View release notes on GitHub"
        title="View release notes on GitHub"
      >
        <Milestone size={16} strokeWidth={2} />
      </button>
    {/if}
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
    <div class="footer-actions">
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
    /* Pushes everything after it (the action buttons) to the right
       edge — equivalent to the old space-between, but works when
       there's a notes-btn sitting between the version and the row's
       left edge. */
    margin-right: auto;
  }
  .version.available {
    color: var(--accent);
    font-weight: 600;
  }
  .footer-actions {
    display: inline-flex;
    gap: 2px;
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
