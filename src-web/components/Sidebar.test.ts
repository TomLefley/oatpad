// @vitest-environment jsdom

import "./testSetup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import type { MeetingSummary } from "../lib/meetings";

// Mock the store before importing the Sidebar so the component reads our
// fixture state. Sidebar only touches `state.meetings` and
// `state.meeting?.meetingId` — everything else flows in through props.
type StoreState = {
  meetings: MeetingSummary[];
  meeting: { meetingId: string } | null;
};

const storeState: StoreState = { meetings: [], meeting: null };

vi.mock("../lib/store.svelte", () => ({
  get state() {
    return storeState;
  },
  // Stubs for setters Settings.svelte calls when rendered inside the
  // settings bubble. Sidebar itself never calls them but the Settings
  // bubble is rendered when settingsOpen is true.
  setNotetaker: vi.fn(),
  setTitle: vi.fn(),
}));

function makeSummary(id: string, title: string, createdAt: string): MeetingSummary {
  return { meetingId: id, title, createdAt };
}

beforeEach(() => {
  storeState.meetings = [];
  storeState.meeting = null;
});

async function mountSidebar(props: {
  collapsed?: boolean;
  width?: number;
  onswitch?: (id: string) => void;
  ondelete?: (id: string) => void | Promise<void>;
  searchOpen?: boolean;
  oncloseSearch?: () => void;
  settingsOpen?: boolean;
  oncloseSettings?: () => void;
} = {}) {
  const Sidebar = (await import("./Sidebar.svelte")).default;
  const result = render(Sidebar, {
    props: {
      collapsed: false,
      width: 280,
      onswitch: vi.fn(),
      ondelete: vi.fn(),
      ...props,
    },
  });
  await tick();
  return result;
}

describe("Sidebar — list rendering", () => {
  it("renders one row per meeting in the order provided by the store", async () => {
    storeState.meetings = [
      makeSummary("a", "First", "2026-04-29T10:00:00.000Z"),
      makeSummary("b", "", "2026-04-28T10:00:00.000Z"),
      makeSummary("c", "Third", "2026-04-27T10:00:00.000Z"),
    ];
    const { container } = await mountSidebar();
    const rows = container.querySelectorAll(".row");
    expect(rows).toHaveLength(3);
    const labels = Array.from(container.querySelectorAll(".row-label"));
    expect(labels[0]?.textContent?.trim()).toBe("First");
    // Untitled rows fall back to "meeting" via labelFor.
    expect(labels[1]?.textContent?.trim()).toBe("meeting");
    expect(labels[2]?.textContent?.trim()).toBe("Third");
  });

  it("flags the current meeting's row with .current", async () => {
    storeState.meetings = [
      makeSummary("a", "A", "2026-04-29T10:00:00.000Z"),
      makeSummary("b", "B", "2026-04-28T10:00:00.000Z"),
    ];
    storeState.meeting = { meetingId: "b" };
    const { container } = await mountSidebar();
    const rows = container.querySelectorAll(".row");
    expect(rows[0]?.classList.contains("current")).toBe(false);
    expect(rows[1]?.classList.contains("current")).toBe(true);
  });

  it("does not render an aside when collapsed", async () => {
    const { container } = await mountSidebar({ collapsed: true });
    expect(container.querySelector("aside.sidebar")).toBeNull();
  });
});

describe("Sidebar — delete-confirmation state machine", () => {
  beforeEach(() => {
    storeState.meetings = [
      makeSummary("a", "Alpha", "2026-04-29T10:00:00.000Z"),
      makeSummary("b", "Beta", "2026-04-28T10:00:00.000Z"),
    ];
  });

  it("first click arms the delete (no callback fired) and second commits", async () => {
    const ondelete = vi.fn();
    const { container } = await mountSidebar({ ondelete });
    const trashButtons = container.querySelectorAll(".row-del");
    expect(trashButtons).toHaveLength(2);

    await fireEvent.click(trashButtons[0]);
    expect(ondelete).not.toHaveBeenCalled();
    // Row is tinted as armed.
    expect(container.querySelectorAll(".row")[0]?.classList.contains("confirming")).toBe(true);
    // Label now reads "Confirm delete?".
    expect(container.querySelectorAll(".row-label")[0]?.textContent?.trim()).toBe(
      "Confirm delete?",
    );

    await fireEvent.click(trashButtons[0]);
    expect(ondelete).toHaveBeenCalledWith("a");
  });

  it("auto-cancels the armed state after the timeout window", async () => {
    vi.useFakeTimers();
    try {
      const ondelete = vi.fn();
      const { container } = await mountSidebar({ ondelete });
      const trashButtons = container.querySelectorAll(".row-del");
      await fireEvent.click(trashButtons[0]);
      expect(container.querySelectorAll(".row")[0]?.classList.contains("confirming")).toBe(true);

      // The component arms for 3000ms (CONFIRM_TIMEOUT_MS).
      vi.advanceTimersByTime(3000);
      await tick();
      expect(container.querySelectorAll(".row")[0]?.classList.contains("confirming")).toBe(false);
      expect(ondelete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("arming a different row cancels the previous arm without firing it", async () => {
    const ondelete = vi.fn();
    const { container } = await mountSidebar({ ondelete });
    const trashButtons = container.querySelectorAll(".row-del");

    await fireEvent.click(trashButtons[0]); // arm row A
    await fireEvent.click(trashButtons[1]); // switch arm to row B
    expect(ondelete).not.toHaveBeenCalled();

    const rows = container.querySelectorAll(".row");
    expect(rows[0]?.classList.contains("confirming")).toBe(false);
    expect(rows[1]?.classList.contains("confirming")).toBe(true);
  });

  it("clicking a row's body cancels an armed delete on that row (switch wins)", async () => {
    const ondelete = vi.fn();
    const onswitch = vi.fn();
    const { container } = await mountSidebar({ ondelete, onswitch });

    const trashButtons = container.querySelectorAll(".row-del");
    await fireEvent.click(trashButtons[0]);
    expect(container.querySelectorAll(".row")[0]?.classList.contains("confirming")).toBe(true);

    const rowMain = container.querySelectorAll(".row-main");
    await fireEvent.click(rowMain[0]);
    expect(onswitch).toHaveBeenCalledWith("a");
    // The arm should be cleared so a follow-up click on the trash icon
    // doesn't silently delete the meeting the user just opened.
    expect(container.querySelectorAll(".row")[0]?.classList.contains("confirming")).toBe(false);
    expect(ondelete).not.toHaveBeenCalled();
  });

  it("Escape clears an armed delete", async () => {
    const ondelete = vi.fn();
    const { container } = await mountSidebar({ ondelete });
    const trashButtons = container.querySelectorAll(".row-del");
    await fireEvent.click(trashButtons[0]);
    expect(container.querySelectorAll(".row")[0]?.classList.contains("confirming")).toBe(true);

    const aside = container.querySelector("aside") as HTMLElement;
    await fireEvent.keyDown(aside, { key: "Escape" });
    expect(container.querySelectorAll(".row")[0]?.classList.contains("confirming")).toBe(false);
  });
});

describe("Sidebar — search bubble", () => {
  beforeEach(() => {
    storeState.meetings = [
      makeSummary("a", "Standup", "2026-04-29T10:00:00.000Z"),
      makeSummary("b", "Retro", "2026-04-28T10:00:00.000Z"),
      makeSummary("c", "Planning", "2026-04-27T10:00:00.000Z"),
    ];
  });

  it("renders the search bubble only when searchOpen is true", async () => {
    const { container, rerender } = await mountSidebar({ searchOpen: false });
    expect(container.querySelector(".search-bubble")).toBeNull();
    await rerender({ collapsed: false, width: 280, onswitch: vi.fn(), ondelete: vi.fn(), searchOpen: true });
    await tick();
    expect(container.querySelector(".search-bubble")).not.toBeNull();
  });

  it("filters the meeting list by typed query", async () => {
    const { container } = await mountSidebar({ searchOpen: true });
    expect(container.querySelectorAll(".row")).toHaveLength(3);

    const input = container.querySelector(".search-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = "stand";
    await fireEvent.input(input);
    await tick();
    const rows = container.querySelectorAll(".row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector(".row-label")?.textContent?.trim()).toBe(
      "Standup",
    );
  });

  it("escape inside the bubble calls oncloseSearch", async () => {
    const oncloseSearch = vi.fn();
    const { container } = await mountSidebar({ searchOpen: true, oncloseSearch });
    const bubble = container.querySelector(".search-bubble") as HTMLElement;
    await fireEvent.keyDown(bubble, { key: "Escape" });
    expect(oncloseSearch).toHaveBeenCalled();
  });

  it("switching to date mode renders the calendar grid", async () => {
    const { container } = await mountSidebar({ searchOpen: true });
    const calendarBtn = container.querySelector(
      'button[aria-label="Filter by date"]',
    ) as HTMLButtonElement;
    expect(calendarBtn).not.toBeNull();
    await fireEvent.click(calendarBtn);
    await tick();
    // The grid is mounted always (both modes coexist) but only the active
    // mode receives `.active`. After clicking the calendar button, .cal
    // gets it.
    const cal = container.querySelector(".cal");
    expect(cal?.classList.contains("active")).toBe(true);
  });

  it("preserves date mode and the selected date across close/reopen", async () => {
    const { container, rerender } = await mountSidebar({ searchOpen: true });
    // Switch to date mode and pick a day.
    const calendarBtn = container.querySelector(
      'button[aria-label="Filter by date"]',
    ) as HTMLButtonElement;
    await fireEvent.click(calendarBtn);
    await tick();
    expect(container.querySelector(".cal")?.classList.contains("active")).toBe(true);
    const cell = container.querySelector(".cal-cell:not(.empty)") as HTMLButtonElement;
    expect(cell).not.toBeNull();
    const ymd = cell.getAttribute("aria-label");
    await fireEvent.click(cell);
    await tick();
    expect(
      container.querySelector(`.cal-cell.selected[aria-label="${ymd}"]`),
    ).not.toBeNull();

    // Close, then re-open — date mode and the selection must survive so
    // the user can come back to a filter they intentionally left behind.
    await rerender({ collapsed: false, width: 280, onswitch: vi.fn(), ondelete: vi.fn(), searchOpen: false });
    await tick();
    await rerender({ collapsed: false, width: 280, onswitch: vi.fn(), ondelete: vi.fn(), searchOpen: true });
    await tick();
    expect(container.querySelector(".cal")?.classList.contains("active")).toBe(true);
    expect(container.querySelector(".text-row")?.classList.contains("active")).toBe(false);
    expect(
      container.querySelector(`.cal-cell.selected[aria-label="${ymd}"]`),
    ).not.toBeNull();
  });
});

describe("Sidebar — settings bubble", () => {
  it("renders the settings bubble only when settingsOpen is true", async () => {
    const { container, rerender } = await mountSidebar({ settingsOpen: false });
    expect(container.querySelector(".settings-bubble")).toBeNull();
    await rerender({
      collapsed: false,
      width: 280,
      onswitch: vi.fn(),
      ondelete: vi.fn(),
      settingsOpen: true,
    });
    await tick();
    expect(container.querySelector(".settings-bubble")).not.toBeNull();
  });

  it("Escape inside the settings bubble calls oncloseSettings", async () => {
    const oncloseSettings = vi.fn();
    const { container } = await mountSidebar({
      settingsOpen: true,
      oncloseSettings,
    });
    const bubble = container.querySelector(".settings-bubble") as HTMLElement;
    await fireEvent.keyDown(bubble, { key: "Escape" });
    expect(oncloseSettings).toHaveBeenCalled();
  });

  it("the settings spacer occupies non-zero height when settingsOpen is true", async () => {
    const { container } = await mountSidebar({ settingsOpen: true });
    const spacer = container.querySelector(".search-spacer") as HTMLElement;
    expect(spacer).not.toBeNull();
    // The component clamps to at least 48 + 24 (SPACER_OVERHEAD), but the
    // exact pixel value depends on jsdom's clientHeight reporting (which
    // is 0 in jsdom). The spacer's inline height is the max of the search
    // and settings spacer heights — in jsdom we can at least assert the
    // style attribute reflects an open spacer (not "0px").
    const style = spacer.getAttribute("style") ?? "";
    expect(/height:\s*\d+px/.test(style)).toBe(true);
    // And height is non-zero.
    const m = style.match(/height:\s*(\d+)px/);
    expect(m && Number(m[1]) > 0).toBe(true);
  });
});
