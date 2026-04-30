/*
 * Component-test setup helpers — install jsdom polyfills that Svelte 5
 * and svelte/animate need at module load. Importing this file for its
 * side effects is enough; nothing is exported.
 *
 * Co-located with the components rather than under lib/ because these
 * shims exist solely for the .svelte tests in this directory.
 */

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver =
    StubResizeObserver;
}

// `animate:flip` and Svelte's transition runtime call element.animate /
// getAnimations (Web Animations API). jsdom ships neither.
type AnimProto = {
  animate?: (...args: unknown[]) => unknown;
  getAnimations?: (...args: unknown[]) => unknown;
};

const animProto = (globalThis.Element?.prototype ??
  (HTMLElement as unknown as { prototype: Element }).prototype) as unknown as AnimProto;

if (!animProto.animate) {
  animProto.animate = () => ({
    cancel: () => {},
    finish: () => {},
    play: () => {},
    pause: () => {},
    reverse: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    onfinish: null,
    oncancel: null,
    finished: Promise.resolve(),
    playState: "finished",
  });
}
if (!animProto.getAnimations) {
  animProto.getAnimations = () => [];
}
