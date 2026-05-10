/*
 * Spacing — the vertical space between adjacent block elements
 * inside the Quill editor (paragraphs, headings, lists). Stored as an
 * em multiplier in localStorage so the value tracks `font-size` rather
 * than freezing at one fixed pixel value.
 *
 * Applied at startup (main.ts) by setting `--spacing` on the
 * document element; the Quill style block in app.css consumes it via
 * `var(--spacing, 0.875em)`. The fallback there is the same as
 * `DEFAULT_EM` so first-paint, fresh-mode runs, and SSR-style envs
 * land on identical spacing.
 */
import { isFreshMode } from "./freshMode";

const LS_KEY = "oatpad.spacing";

// Five snap points across the full range. The midpoint (snap 2) lands
// on Quill's original 0.875em margin so the slider's centre matches the
// editor's historical default — making the snap pattern feel anchored
// rather than arbitrary. Step = (MAX - MIN) / 4.
export const SPACING_DEFAULT = 0.875;
export const SPACING_MIN = 0;
export const SPACING_MAX = 1.75;
export const SPACING_STEP = 0.4375;

function clamp(em: number): number {
  return Math.min(SPACING_MAX, Math.max(SPACING_MIN, em));
}

export function loadSpacing(): number {
  if (isFreshMode) return SPACING_DEFAULT;
  if (typeof localStorage === "undefined") return SPACING_DEFAULT;
  const raw = localStorage.getItem(LS_KEY);
  if (raw === null) return SPACING_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return SPACING_DEFAULT;
  return clamp(n);
}

export function saveSpacing(em: number): void {
  if (isFreshMode) return;
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_KEY, String(clamp(em)));
}

export function applySpacing(em: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--spacing",
    `${clamp(em)}em`,
  );
}
