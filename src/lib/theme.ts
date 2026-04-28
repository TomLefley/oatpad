import { isFreshMode } from "./freshMode";

export type Theme = "system" | "light" | "dark";

const LS_THEME = "oatpad.theme";

export function loadTheme(): Theme {
  if (isFreshMode) return "system";
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(LS_THEME);
  return v === "light" || v === "dark" ? v : "system";
}

export function saveTheme(t: Theme): void {
  if (isFreshMode) return;
  if (typeof localStorage === "undefined") return;
  if (t === "system") localStorage.removeItem(LS_THEME);
  else localStorage.setItem(LS_THEME, t);
}

export function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return;
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

export function cycleTheme(t: Theme): Theme {
  return t === "system" ? "light" : t === "light" ? "dark" : "system";
}
