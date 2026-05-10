// @vitest-environment jsdom

import "./testSetup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

// Settings composes McpRow + UpdaterRow with theme + spacing controls.
// Mock the lib helpers so we can assert on the side-effects each control
// triggers without exercising localStorage / DOM mutation.

const loadTheme = vi.fn(() => "system");
const saveTheme = vi.fn();
const applyTheme = vi.fn();
const loadSpacing = vi.fn(() => 0.875);
const saveSpacing = vi.fn();
const applySpacing = vi.fn();

vi.mock("../lib/theme", () => ({
  loadTheme: () => loadTheme(),
  saveTheme: (t: string) => saveTheme(t),
  applyTheme: (t: string) => applyTheme(t),
}));

vi.mock("../lib/spacing", () => ({
  loadSpacing: () => loadSpacing(),
  saveSpacing: (n: number) => saveSpacing(n),
  applySpacing: (n: number) => applySpacing(n),
  SPACING_MIN: 0,
  SPACING_MAX: 1.75,
  SPACING_STEP: 0.4375,
  SPACING_DEFAULT: 0.875,
}));

// Render-time stubs for the McpRow / UpdaterRow Tauri imports so they
// don't blow up when Settings mounts them.
vi.mock("../lib/config", () => ({
  loadConfig: vi.fn().mockResolvedValue({ mcpEnabled: true, mcpInstalled: false }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.0.0"),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

beforeEach(() => {
  loadTheme.mockReset().mockReturnValue("system");
  saveTheme.mockReset();
  applyTheme.mockReset();
  loadSpacing.mockReset().mockReturnValue(0.875);
  saveSpacing.mockReset();
  applySpacing.mockReset();
});

async function mountSettings() {
  const Settings = (await import("./Settings.svelte")).default;
  const result = render(Settings);
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await tick();
  }
  return result;
}

describe("Settings — theme picker", () => {
  it("marks the loaded theme as the active radio button", async () => {
    loadTheme.mockReturnValueOnce("dark");
    const { container } = await mountSettings();
    const dark = container.querySelector(
      'button[aria-label="Dark theme"]',
    ) as HTMLButtonElement;
    expect(dark.classList.contains("active")).toBe(true);
    expect(dark.getAttribute("aria-checked")).toBe("true");
  });

  it("clicking a different theme calls saveTheme + applyTheme and updates active state", async () => {
    loadTheme.mockReturnValueOnce("system");
    const { container } = await mountSettings();
    const light = container.querySelector(
      'button[aria-label="Light theme"]',
    ) as HTMLButtonElement;
    await fireEvent.click(light);
    await tick();
    expect(saveTheme).toHaveBeenCalledWith("light");
    expect(applyTheme).toHaveBeenCalledWith("light");
    expect(light.classList.contains("active")).toBe(true);
  });

  it("clicking the already-active theme is a no-op", async () => {
    loadTheme.mockReturnValueOnce("light");
    const { container } = await mountSettings();
    const light = container.querySelector(
      'button[aria-label="Light theme"]',
    ) as HTMLButtonElement;
    await fireEvent.click(light);
    expect(saveTheme).not.toHaveBeenCalled();
    expect(applyTheme).not.toHaveBeenCalled();
  });
});

describe("Settings — spacing slider", () => {
  it("oninput calls applySpacing and saveSpacing with the new value", async () => {
    loadSpacing.mockReturnValueOnce(0.875);
    const { container } = await mountSettings();
    const slider = container.querySelector(
      "input.gap-slider",
    ) as HTMLInputElement;
    expect(slider).not.toBeNull();
    slider.value = "1.3125";
    await fireEvent.input(slider);
    await tick();
    expect(applySpacing).toHaveBeenCalledWith(1.3125);
    expect(saveSpacing).toHaveBeenCalledWith(1.3125);
  });

  it("renders the slider min/max/step from the lib constants", async () => {
    const { container } = await mountSettings();
    const slider = container.querySelector(
      "input.gap-slider",
    ) as HTMLInputElement;
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("1.75");
    expect(slider.step).toBe("0.4375");
  });
});
