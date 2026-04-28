<script lang="ts">
  import { onMount } from "svelte";
  import X from "@lucide/svelte/icons/x";

  type Props = {
    targetSelector: string;
    text: string;
    ondismiss: () => void;
  };
  let { targetSelector, text, ondismiss }: Props = $props();

  let bodyEl: HTMLDivElement | undefined = $state();
  let left = $state(0);
  let top = $state(0);
  let arrowOffset = $state(0);
  // The bubble is hidden until the first position calculation lands. Without
  // this we'd briefly paint at (0, 0) before the layout kicks in.
  let positioned = $state(false);

  function updatePosition(): void {
    const target = document.querySelector(targetSelector) as HTMLElement | null;
    if (!target || !bodyEl) return;
    const tr = target.getBoundingClientRect();
    const br = bodyEl.getBoundingClientRect();
    const desiredLeft = tr.left + tr.width / 2 - br.width / 2;
    const clampedLeft = Math.max(
      8,
      Math.min(window.innerWidth - br.width - 8, desiredLeft),
    );
    left = clampedLeft;
    top = tr.bottom + 8;
    arrowOffset = tr.left + tr.width / 2 - clampedLeft;
    positioned = true;
  }

  let rafId: number | null = null;
  function loop(): void {
    updatePosition();
    rafId = requestAnimationFrame(loop);
  }

  onMount(() => {
    updatePosition();
    // Repaint each frame so the bubble follows the target through sidebar
    // resizes, window resizes, and any other layout shifts. getBoundingClientRect
    // is cheap enough that 60fps is fine for the brief lifetime of a coachmark.
    rafId = requestAnimationFrame(loop);
    // Dismiss the moment the user engages with the target — by then the
    // prompt has done its job and a bubble hovering over an active input
    // would just be noise.
    const target = document.querySelector(targetSelector) as HTMLElement | null;
    const onTargetFocus = (): void => ondismiss();
    if (target) target.addEventListener("focus", onTargetFocus);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (target) target.removeEventListener("focus", onTargetFocus);
    };
  });

  function handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      ondismiss();
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

<div
  class="coachmark"
  class:visible={positioned}
  style:left="{left}px"
  style:top="{top}px"
  style:--arrow-x="{arrowOffset}px"
  role="dialog"
  aria-live="polite"
>
  <span class="arrow" aria-hidden="true"></span>
  <div bind:this={bodyEl} class="body">
    <span class="text">{text}</span>
    <button
      class="close"
      onclick={ondismiss}
      aria-label="Dismiss"
      title="Dismiss"
    >
      <X size={14} strokeWidth={2.4} />
    </button>
  </div>
</div>

<style>
  .coachmark {
    --bubble-bg: color-mix(in srgb, var(--surface) 70%, var(--fg) 30%);
    position: fixed;
    z-index: 100;
    padding-top: 6px;
    opacity: 0;
    pointer-events: none;
    transform-origin: var(--arrow-x, 50%) 0;
  }
  .coachmark.visible {
    pointer-events: auto;
    /* Same two-phase pop as the search bubble: ease-out launch from 0.58,
       overshoot at 65% to 1.07, then settle. fill-mode: both — backwards so
       the 0% keyframe paints from frame zero (no full-size flash before the
       animation), and forwards so the 100% keyframe sticks after it ends
       (otherwise the base .coachmark { opacity: 0 } reasserts). */
    animation: coachmark-pop 200ms linear both;
  }
  @keyframes coachmark-pop {
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
  .arrow {
    position: absolute;
    top: 0;
    left: var(--arrow-x);
    width: 0;
    height: 0;
    margin-left: -6px;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 6px solid var(--bubble-bg);
  }
  .body {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bubble-bg);
    border-radius: 18px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
    padding: 6px 6px 6px 14px;
    color: var(--fg);
    font-size: 13px;
    white-space: nowrap;
  }
  .close {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: color-mix(in srgb, var(--fg) 60%, transparent);
    cursor: pointer;
    transition:
      color 120ms ease,
      background-color 120ms ease;
  }
  .close:hover {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 12%, transparent);
  }
  .close:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
</style>
