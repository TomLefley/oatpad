<script lang="ts">
  import { scale } from "svelte/transition";
  import Settings from "./Settings.svelte";

  type Props = {
    onclose: () => void;
    // Bubble's measured content height — the parent reads this to size
    // the spacer above the meeting list so the list slides clear in
    // lockstep with the bubble's body height transition.
    contentHeight: number;
  };
  let { onclose, contentHeight = $bindable() }: Props = $props();

  let bubbleEl: HTMLDivElement | undefined = $state();
  // Match the search bubble's staged entry: hide the contents until the
  // bubble's pop settles, otherwise the toggles inside flash through the
  // scaling shell as a square.
  let contentsVisible = $state(false);

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    }
  }
</script>

<div class="search-bubble-anchor">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={bubbleEl}
    class="search-bubble settings-bubble"
    out:scale={{ duration: 100 }}
    onanimationend={() => {
      contentsVisible = true;
      // Focus the bubble itself so ESC reaches handleKeydown even before
      // the user interacts with anything inside.
      bubbleEl?.focus({ preventScroll: true });
    }}
    onkeydown={handleKeydown}
    role="dialog"
    aria-label="Settings"
    tabindex="-1"
  >
    <span class="search-arrow settings-arrow" aria-hidden="true"></span>
    <div class="search-body settings-body">
      <div
        class="settings-stack"
        class:visible={contentsVisible}
        bind:clientHeight={contentHeight}
      >
        <Settings />
      </div>
    </div>
  </div>
</div>

<style>
  /* Settings bubble shares the search-bubble shell — same anchor, same
     pop animation, same body radius. Only the arrow position and the
     pop transform-origin differ (both pinned to the cog instead of the
     search icon). Styles are duplicated rather than shared via app.css
     because they're scoped to this component's class names. */
  .search-bubble-anchor {
    position: absolute;
    top: 0;
    left: 12px;
    right: 12px;
    z-index: 1;
  }
  .search-bubble {
    --bubble-bg: color-mix(in srgb, var(--surface) 70%, var(--fg) 30%);
    position: relative;
    padding-top: 6px;
    /* The entry uses a CSS animation rather than a Svelte transition because
       Svelte applies tick(0) on requestAnimationFrame, leaving one frame
       where the bubble paints at its natural (full) size — that's the
       square-ended flash the user was seeing. `animation-fill-mode: backwards`
       guarantees the 0% keyframe is painted from the very first frame.
       The 30ms delay lets the spacer's slide get started, so the bubble
       only becomes visible once there's space for it. */
    animation: pop-in 160ms linear 30ms backwards;
    outline: none;
  }
  /* Two-phase pop: ease-out launch from 0.58 scale, overshoot to 1.07 at
     the midpoint, then a damped settle back to 1. */
  @keyframes pop-in {
    0% {
      transform: scale(0.58);
      opacity: 0;
      animation-timing-function: cubic-bezier(0.2, 0.8, 0.4, 1);
    }
    65% {
      transform: scale(1.07);
      opacity: 1;
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }
  .search-arrow {
    position: absolute;
    top: 0;
    width: 0;
    height: 0;
    border-left: var(--bubble-arrow-half) solid transparent;
    border-right: var(--bubble-arrow-half) solid transparent;
    border-bottom: var(--bubble-arrow-half) solid var(--bubble-bg);
  }
  /* Settings bubble's arrow sits over the cog (the leftmost icon in the
     expanded tray) — same derivation as the search bubble's arrow but
     using --tray-settings-center. */
  .settings-arrow {
    right: calc(
      var(--tray-settings-center) - var(--bubble-margin) - var(--bubble-arrow-half)
    );
  }
  .settings-bubble {
    /* Pop emanates from just below the cog. */
    transform-origin: calc(
      100% - (var(--tray-settings-center) - var(--bubble-margin))
    ) 0;
  }
  .search-body {
    background: var(--bubble-bg);
    border-radius: 18px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  }
  .settings-body {
    padding: 8px 12px 10px;
  }
  .settings-stack {
    opacity: 0;
    transition: opacity 150ms ease;
  }
  .settings-stack.visible {
    opacity: 1;
  }
</style>
