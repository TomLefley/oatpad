// @vitest-environment jsdom

import "./testSetup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

const storeState: { meeting: { meetingId: string; title: string } | null } = {
  meeting: null,
};

vi.mock("../lib/store.svelte", () => ({
  get state() {
    return storeState;
  },
  setNotetaker: vi.fn(),
  setTitle: vi.fn(),
}));

let isNativeFlag = false;
vi.mock("../lib/platform", () => ({
  get isNative() {
    return isNativeFlag;
  },
  get isWeb() {
    return !isNativeFlag;
  },
}));

beforeEach(() => {
  storeState.meeting = null;
  isNativeFlag = false;
});

async function mountHeader(props: {
  onnew?: () => void;
  onopen?: () => void;
  onsave?: () => void;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  ontogglesidebar?: () => void;
  searchOpen?: boolean;
  ontogglesearch?: () => void;
  settingsOpen?: boolean;
  ontogglesettings?: () => void;
  searchHasFilter?: boolean;
  updateReady?: boolean;
} = {}) {
  const Header = (await import("./Header.svelte")).default;
  const result = render(Header, {
    props: {
      onnew: vi.fn(),
      onopen: vi.fn(),
      onsave: vi.fn(),
      ...props,
    },
  });
  await tick();
  return result;
}

describe("Header — web mode", () => {
  it("shows the IconButton actions and ThemeToggle, not the native left-col tray", async () => {
    storeState.meeting = { meetingId: "m", title: "t" };
    const { container } = await mountHeader();
    expect(container.querySelector(".left-col")).toBeNull();
    expect(container.querySelector(".actions")).not.toBeNull();
    const newBtn = container.querySelector('button[aria-label="New meeting"]');
    expect(newBtn).not.toBeNull();
  });

  it("hides the title on the Getting Started view (no meeting)", async () => {
    storeState.meeting = null;
    const { container } = await mountHeader();
    expect(container.querySelector(".title")).toBeNull();
  });

  it("clicking each web action button fires the corresponding callback", async () => {
    const onnew = vi.fn();
    const onopen = vi.fn();
    const onsave = vi.fn();
    const { container } = await mountHeader({ onnew, onopen, onsave });
    const newBtn = container.querySelector('button[aria-label="New meeting"]') as HTMLButtonElement;
    const openBtn = container.querySelector('button[aria-label="Open file"]') as HTMLButtonElement;
    const saveBtn = container.querySelector('button[aria-label="Save file"]') as HTMLButtonElement;
    await fireEvent.click(newBtn);
    await fireEvent.click(openBtn);
    await fireEvent.click(saveBtn);
    expect(onnew).toHaveBeenCalledOnce();
    expect(onopen).toHaveBeenCalledOnce();
    expect(onsave).toHaveBeenCalledOnce();
  });
});

describe("Header — native mode tray", () => {
  beforeEach(() => {
    isNativeFlag = true;
  });

  it("renders the icon-tray with toggle, new, search, and settings buttons", async () => {
    const { container } = await mountHeader({ sidebarCollapsed: false });
    expect(container.querySelector(".icon-tray")).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="New meeting"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Search meetings"]'),
    ).not.toBeNull();
    expect(container.querySelector('button[aria-label="Settings"]')).not.toBeNull();
  });

  it("toggle button has the correct aria-label and title for the current state", async () => {
    const { container, rerender } = await mountHeader({ sidebarCollapsed: true });
    const collapsedBtn = container.querySelector(
      ".toggle-slot",
    ) as HTMLButtonElement;
    expect(collapsedBtn.getAttribute("aria-label")).toBe("Open sidebar");
    expect(collapsedBtn.title).toBe("Open sidebar");
    await rerender({
      onnew: vi.fn(),
      onopen: vi.fn(),
      onsave: vi.fn(),
      sidebarCollapsed: false,
    });
    await tick();
    expect(collapsedBtn.getAttribute("aria-label")).toBe("Close sidebar");
  });

  it("settings button reflects settingsOpen via aria-expanded + .active", async () => {
    const { container, rerender } = await mountHeader({
      sidebarCollapsed: false,
      settingsOpen: false,
    });
    const settingsBtn = container.querySelector(
      'button[aria-label="Settings"]',
    ) as HTMLButtonElement;
    expect(settingsBtn.classList.contains("active")).toBe(false);
    expect(settingsBtn.getAttribute("aria-expanded")).toBe("false");

    await rerender({
      onnew: vi.fn(),
      onopen: vi.fn(),
      onsave: vi.fn(),
      sidebarCollapsed: false,
      settingsOpen: true,
    });
    await tick();
    expect(settingsBtn.classList.contains("active")).toBe(true);
    expect(settingsBtn.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapse-transition wobble: applies .bouncing-out for ~600ms when sidebar collapses", async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = await mountHeader({
        sidebarCollapsed: false,
      });
      const tray = container.querySelector(".icon-tray") as HTMLElement;
      // Mounted-expanded: bouncing-in is on, bouncing-out is off.
      expect(tray.classList.contains("bouncing-in")).toBe(true);
      expect(tray.classList.contains("bouncing-out")).toBe(false);

      // Collapse: bouncing-out should turn on.
      await rerender({
        onnew: vi.fn(),
        onopen: vi.fn(),
        onsave: vi.fn(),
        sidebarCollapsed: true,
      });
      await tick();
      expect(tray.classList.contains("bouncing-out")).toBe(true);

      // Hold for 599ms — still on.
      vi.advanceTimersByTime(599);
      await tick();
      expect(tray.classList.contains("bouncing-out")).toBe(true);

      // Cross 600ms — flag clears.
      vi.advanceTimersByTime(2);
      await tick();
      expect(tray.classList.contains("bouncing-out")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-expanding mid-collapse cancels the wobble timer (bouncing-out clears immediately)", async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = await mountHeader({
        sidebarCollapsed: false,
      });
      // Collapse, then immediately expand again.
      await rerender({
        onnew: vi.fn(),
        onopen: vi.fn(),
        onsave: vi.fn(),
        sidebarCollapsed: true,
      });
      await tick();
      const tray = container.querySelector(".icon-tray") as HTMLElement;
      expect(tray.classList.contains("bouncing-out")).toBe(true);

      await rerender({
        onnew: vi.fn(),
        onopen: vi.fn(),
        onsave: vi.fn(),
        sidebarCollapsed: false,
      });
      await tick();
      expect(tray.classList.contains("bouncing-out")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("search icon shows a notification dot when a filter is active and the bubble is closed", async () => {
    const { container, rerender } = await mountHeader({
      sidebarCollapsed: false,
      searchOpen: false,
      searchHasFilter: true,
    });
    const searchBtn = container.querySelector(
      'button[aria-label="Search meetings"]',
    ) as HTMLButtonElement;
    expect(searchBtn.querySelector(".dot")).not.toBeNull();
    expect(searchBtn.title).toMatch(/filter active/);

    // Opening the bubble drops the dot — the bubble itself is now showing
    // the user the same information.
    await rerender({
      onnew: vi.fn(),
      onopen: vi.fn(),
      onsave: vi.fn(),
      sidebarCollapsed: false,
      searchOpen: true,
      searchHasFilter: true,
    });
    await tick();
    expect(searchBtn.querySelector(".dot")).toBeNull();
  });

  it("settings icon shows a notification dot when an update is ready and the bubble is closed", async () => {
    const { container, rerender } = await mountHeader({
      sidebarCollapsed: false,
      settingsOpen: false,
      updateReady: true,
    });
    const settingsBtn = container.querySelector(
      'button[aria-label="Settings"]',
    ) as HTMLButtonElement;
    expect(settingsBtn.querySelector(".dot")).not.toBeNull();
    expect(settingsBtn.title).toMatch(/update ready/);

    // Opening settings hides the dot.
    await rerender({
      onnew: vi.fn(),
      onopen: vi.fn(),
      onsave: vi.fn(),
      sidebarCollapsed: false,
      settingsOpen: true,
      updateReady: true,
    });
    await tick();
    expect(settingsBtn.querySelector(".dot")).toBeNull();
  });

  it("renders no dots when neither signal is set", async () => {
    const { container } = await mountHeader({
      sidebarCollapsed: false,
      searchHasFilter: false,
      updateReady: false,
    });
    expect(container.querySelectorAll(".dot")).toHaveLength(0);
  });

  it("toggle / search / settings buttons fire their respective callbacks", async () => {
    const ontogglesidebar = vi.fn();
    const ontogglesearch = vi.fn();
    const ontogglesettings = vi.fn();
    const { container } = await mountHeader({
      sidebarCollapsed: false,
      ontogglesidebar,
      ontogglesearch,
      ontogglesettings,
    });
    await fireEvent.click(
      container.querySelector(".toggle-slot") as HTMLButtonElement,
    );
    await fireEvent.click(
      container.querySelector(
        'button[aria-label="Search meetings"]',
      ) as HTMLButtonElement,
    );
    await fireEvent.click(
      container.querySelector(
        'button[aria-label="Settings"]',
      ) as HTMLButtonElement,
    );
    expect(ontogglesidebar).toHaveBeenCalledOnce();
    expect(ontogglesearch).toHaveBeenCalledOnce();
    expect(ontogglesettings).toHaveBeenCalledOnce();
  });
});
