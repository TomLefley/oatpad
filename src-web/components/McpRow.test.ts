// @vitest-environment jsdom

import "./testSetup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

const loadConfig = vi.fn();
const saveConfig = vi.fn();
const invoke = vi.fn();

vi.mock("../lib/config", () => ({
  loadConfig: () => loadConfig(),
  saveConfig: (c: { mcpEnabled: boolean; mcpInstalled: boolean }) =>
    saveConfig(c),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => invoke(cmd),
}));

beforeEach(() => {
  loadConfig.mockReset();
  saveConfig.mockReset().mockResolvedValue(undefined);
  invoke.mockReset();
});

async function mountMcpRow() {
  const McpRow = (await import("./McpRow.svelte")).default;
  const result = render(McpRow);
  // Yield twice: first tick lands $effect, second resolves loadConfig().
  await tick();
  await Promise.resolve();
  await tick();
  return result;
}

describe("McpRow", () => {
  it("disables both buttons until loadConfig resolves (configLoaded gate)", async () => {
    let release!: (c: { mcpEnabled: boolean; mcpInstalled: boolean }) => void;
    loadConfig.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    const { container } = await mountMcpRow();
    const buttons = container.querySelectorAll<HTMLButtonElement>("button.mcp-btn");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(true);

    release({ mcpEnabled: true, mcpInstalled: false });
    await tick();
    await Promise.resolve();
    await tick();
    expect(buttons[1].disabled).toBe(false);
  });

  it("shows the install button as active and labels it 'Reinstall' once mcpInstalled is true", async () => {
    loadConfig.mockResolvedValue({ mcpEnabled: true, mcpInstalled: true });
    const { container } = await mountMcpRow();
    const installBtn = container.querySelector(
      'button.mcp-btn[aria-label*="install"], button.mcp-btn[aria-label*="Reinstall"]',
    ) as HTMLButtonElement;
    expect(installBtn).not.toBeNull();
    expect(installBtn.classList.contains("active")).toBe(true);
    expect(installBtn.getAttribute("aria-label")).toMatch(/Reinstall/);
  });

  it("toggle button reflects mcpEnabled and flips on click via saveConfig", async () => {
    loadConfig.mockResolvedValue({ mcpEnabled: true, mcpInstalled: false });
    const { container } = await mountMcpRow();
    const toggle = container.querySelector(
      'button[role="switch"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await fireEvent.click(toggle);
    await Promise.resolve();
    await tick();
    expect(saveConfig).toHaveBeenCalledWith({
      mcpEnabled: false,
      mcpInstalled: false,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("rolls the toggle back when saveConfig rejects", async () => {
    loadConfig.mockResolvedValue({ mcpEnabled: true, mcpInstalled: false });
    saveConfig.mockRejectedValueOnce(new Error("disk full"));
    const { container } = await mountMcpRow();
    const toggle = container.querySelector(
      'button[role="switch"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await fireEvent.click(toggle);
    // Two microtasks for the rejected promise + UI flip-back.
    await Promise.resolve();
    await Promise.resolve();
    await tick();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("install button calls invoke('install_mcpb') and persists the install marker", async () => {
    loadConfig.mockResolvedValue({ mcpEnabled: true, mcpInstalled: false });
    invoke.mockResolvedValue(undefined);
    const { container } = await mountMcpRow();
    const installBtn = container.querySelector(
      'button.mcp-btn[aria-label*="Install Oatpad"]',
    ) as HTMLButtonElement;
    expect(installBtn).not.toBeNull();
    await fireEvent.click(installBtn);
    await Promise.resolve();
    await Promise.resolve();
    await tick();
    expect(invoke).toHaveBeenCalledWith("install_mcpb");
    expect(saveConfig).toHaveBeenCalledWith({
      mcpEnabled: true,
      mcpInstalled: true,
    });
    expect(installBtn.classList.contains("active")).toBe(true);
  });

  it("surfaces an install failure in the title attribute and leaves mcpInstalled false", async () => {
    loadConfig.mockResolvedValue({ mcpEnabled: true, mcpInstalled: false });
    invoke.mockRejectedValueOnce(new Error("kaboom"));
    const { container } = await mountMcpRow();
    const installBtn = container.querySelector(
      'button.mcp-btn[aria-label*="Install Oatpad"]',
    ) as HTMLButtonElement;
    await fireEvent.click(installBtn);
    await Promise.resolve();
    await Promise.resolve();
    await tick();
    expect(installBtn.title).toMatch(/Install failed: .*kaboom/);
    expect(installBtn.classList.contains("active")).toBe(false);
  });
});
