// Registers afterEach(cleanup) so components mounted by
// @testing-library/svelte are unmounted between tests. Without this,
// timers scheduled inside components (e.g. Editor.svelte's snapshot
// debounce) can fire after the test's jsdom environment is torn down,
// producing "HTMLElement is not defined" unhandled errors.
import "@testing-library/svelte/vitest";
