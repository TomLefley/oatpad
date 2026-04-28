/*
 * Oatpad ships in two forms:
 *   - `isNative`: the Tauri-wrapped macOS .app (`just build-app`)
 *   - `isWeb`:    a plain browser page served by `npm run dev`
 *
 * Convention for platform-divergent behaviour:
 *   - Keep the branch *inside the feature's own module* (see `file.ts`) — not
 *     sprinkled across components. Components should render what the feature
 *     hands back, agnostic to how it was produced.
 *   - For pure styling differences, use `:global(html.native)` in scoped CSS.
 */

export const isNative: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const isWeb: boolean = !isNative;

if (isNative && typeof document !== "undefined") {
  document.documentElement.classList.add("native");
}
