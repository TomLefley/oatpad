/*
 * Fresh mode — short-circuits all persistence.
 *
 * When enabled, every read from localStorage returns empty/null, every
 * write is a no-op, and the native meetings module keeps meetings in an
 * in-memory cache instead of writing to disk. The session works normally
 * (you can create, edit, switch, delete meetings) but nothing survives
 * a relaunch.
 *
 * Toggle: prefix the dev command with `VITE_FRESH=1`, e.g.
 *   VITE_FRESH=1 npm run tauri:dev
 *   VITE_FRESH=1 npm run dev
 * Or use the `just run-app-fresh` recipe.
 */

export const isFreshMode: boolean = import.meta.env.VITE_FRESH === "1";

if (isFreshMode && typeof console !== "undefined") {
  console.info(
    "%c[oatpad] fresh mode enabled — prefs and data won't persist",
    "color: #8b6a3e; font-weight: 600",
  );
}
