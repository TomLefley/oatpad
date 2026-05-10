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

function makeSummary(
  id: string,
  title: string,
  createdAt: string,
  extras: Partial<Pick<MeetingSummary, "scheduledStartAt" | "started">> = {},
): MeetingSummary {
  return { meetingId: id, title, createdAt, started: true, ...extras };
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

describe("Sidebar — scheduled-but-not-started rows", () => {
  it("renders a clock icon and the scheduled time for unstarted rows", async () => {
    storeState.meetings = [
      makeSummary("a", "Planned", "2026-04-29T08:00:00.000Z", {
        scheduledStartAt: "2026-04-29T15:00:00.000Z",
        started: false,
      }),
      makeSummary("b", "Already running", "2026-04-29T09:00:00.000Z", {
        // Even with a scheduledStartAt set, started=true means the row
        // is back in the regular post-start view (no clock icon).
        scheduledStartAt: "2026-04-29T10:00:00.000Z",
        started: true,
      }),
    ];
    const { container } = await mountSidebar();
    const rows = container.querySelectorAll(".row");
    // Only the unstarted row gets the clock marker.
    expect(rows[0]?.querySelector(".scheduled-icon")).not.toBeNull();
    expect(rows[1]?.querySelector(".scheduled-icon")).toBeNull();
  });

  it("uses scheduledStartAt as the displayed time on unstarted rows", async () => {
    // Pin "now" to the same day as the fixture so fmtTimestamp takes
    // the same-day branch and renders HH:MM (rather than a "29 Apr"
    // date), letting us assert on the time that's actually used.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T12:00:00.000Z"));
    try {
      storeState.meetings = [
        makeSummary("a", "Planned", "2026-04-29T08:00:00.000Z", {
          scheduledStartAt: "2026-04-29T15:00:00.000Z",
          started: false,
        }),
      ];
      const { container } = await mountSidebar();
      const time = container.querySelector(".row-time");
      const d = new Date("2026-04-29T15:00:00.000Z");
      const hh = String(d.getHours()).padStart(2, "0");
      expect(time?.textContent).toMatch(new RegExp(`${hh}:`));

      // The createdAt's local hours must not be what we rendered —
      // otherwise we'd be sorting by schedule but displaying the
      // creation time, which is the bug this guards against.
      const c = new Date("2026-04-29T08:00:00.000Z");
      const chh = String(c.getHours()).padStart(2, "0");
      if (chh !== hh) {
        expect(time?.textContent).not.toMatch(new RegExp(`${chh}:`));
      }
    } finally {
      vi.useRealTimers();
    }
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

  it("shows the calendar switcher while the text query is empty", async () => {
    const { container } = await mountSidebar({ searchOpen: true });
    expect(
      container.querySelector('button[aria-label="Filter by date"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('.text-row button[aria-label="Clear search"]'),
    ).toBeNull();
  });

  it("replaces the calendar switcher with a clear button while a query is entered", async () => {
    const { container } = await mountSidebar({ searchOpen: true });
    const input = container.querySelector(".search-input") as HTMLInputElement;
    input.value = "stand";
    await fireEvent.input(input);
    await tick();
    expect(
      container.querySelector('button[aria-label="Filter by date"]'),
    ).toBeNull();
    expect(
      container.querySelector('.text-row button[aria-label="Clear search"]'),
    ).not.toBeNull();
  });

  it("clear button resets the text query", async () => {
    const { container } = await mountSidebar({ searchOpen: true });
    const input = container.querySelector(".search-input") as HTMLInputElement;
    input.value = "stand";
    await fireEvent.input(input);
    await tick();
    const clearBtn = container.querySelector(
      '.text-row button[aria-label="Clear search"]',
    ) as HTMLButtonElement;
    await fireEvent.click(clearBtn);
    await tick();
    expect(
      (container.querySelector(".search-input") as HTMLInputElement).value,
    ).toBe("");
    // All meetings are visible again.
    expect(container.querySelectorAll(".row")).toHaveLength(3);
  });

  // Helpers for the date-mode tests that need the calendar to open on a
  // month containing the fixture's meetings (April 2026). Pin "now" inside
  // that month so monthStart(new Date()) lands on 2026-04-01.
  function pinAprilTwentySix() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15, 12, 0, 0));
  }

  it("a single click in date mode selects one day", async () => {
    pinAprilTwentySix();
    try {
      const { container } = await mountSidebar({ searchOpen: true });
      await fireEvent.click(
        container.querySelector(
          'button[aria-label="Filter by date"]',
        ) as HTMLButtonElement,
      );
      await tick();
      const target = container.querySelector(
        '.cal-cell[aria-label="2026-04-27"]',
      ) as HTMLButtonElement;
      expect(target).not.toBeNull();
      await fireEvent.click(target);
      await tick();
      const selected = container.querySelectorAll(".cal-cell.selected");
      expect(selected).toHaveLength(1);
      expect(selected[0]?.getAttribute("aria-label")).toBe("2026-04-27");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second click on a later day extends the selection into a range", async () => {
    pinAprilTwentySix();
    try {
      const { container } = await mountSidebar({ searchOpen: true });
      await fireEvent.click(
        container.querySelector(
          'button[aria-label="Filter by date"]',
        ) as HTMLButtonElement,
      );
      await tick();
      const cellByYmd = (ymd: string) =>
        container.querySelector(
          `.cal-cell[aria-label="${ymd}"]`,
        ) as HTMLButtonElement;
      await fireEvent.click(cellByYmd("2026-04-27"));
      await tick();
      await fireEvent.click(cellByYmd("2026-04-29"));
      await tick();
      const selected = Array.from(
        container.querySelectorAll(".cal-cell.selected"),
      ).map((c) => c.getAttribute("aria-label"));
      expect(selected.sort()).toEqual(["2026-04-27", "2026-04-29"]);
      const inRange = Array.from(
        container.querySelectorAll(".cal-cell.in-range"),
      ).map((c) => c.getAttribute("aria-label"));
      expect(inRange).toContain("2026-04-28");
      // Filter resolves to all three meetings within the range.
      const labels = Array.from(container.querySelectorAll(".row-label")).map(
        (l) => l.textContent?.trim(),
      );
      expect(labels.sort()).toEqual(["Planning", "Retro", "Standup"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clicking a day before the current start swaps endpoints to keep start ≤ end", async () => {
    pinAprilTwentySix();
    try {
      const { container } = await mountSidebar({ searchOpen: true });
      await fireEvent.click(
        container.querySelector(
          'button[aria-label="Filter by date"]',
        ) as HTMLButtonElement,
      );
      await tick();
      const cellByYmd = (ymd: string) =>
        container.querySelector(
          `.cal-cell[aria-label="${ymd}"]`,
        ) as HTMLButtonElement;
      await fireEvent.click(cellByYmd("2026-04-29"));
      await tick();
      await fireEvent.click(cellByYmd("2026-04-27"));
      await tick();
      const selected = Array.from(
        container.querySelectorAll(".cal-cell.selected"),
      ).map((c) => c.getAttribute("aria-label"));
      expect(selected.sort()).toEqual(["2026-04-27", "2026-04-29"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clicking a third day after a range is set starts a fresh single-day selection", async () => {
    pinAprilTwentySix();
    try {
      const { container } = await mountSidebar({ searchOpen: true });
      await fireEvent.click(
        container.querySelector(
          'button[aria-label="Filter by date"]',
        ) as HTMLButtonElement,
      );
      await tick();
      const cellByYmd = (ymd: string) =>
        container.querySelector(
          `.cal-cell[aria-label="${ymd}"]`,
        ) as HTMLButtonElement;
      await fireEvent.click(cellByYmd("2026-04-27"));
      await fireEvent.click(cellByYmd("2026-04-29"));
      await fireEvent.click(cellByYmd("2026-04-28"));
      await tick();
      const selected = Array.from(
        container.querySelectorAll(".cal-cell.selected"),
      ).map((c) => c.getAttribute("aria-label"));
      expect(selected).toEqual(["2026-04-28"]);
      expect(container.querySelectorAll(".cal-cell.in-range")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("date-mode clear button only appears once a day is picked, and clears the selection", async () => {
    pinAprilTwentySix();
    try {
      const { container } = await mountSidebar({ searchOpen: true });
      await fireEvent.click(
        container.querySelector(
          'button[aria-label="Filter by date"]',
        ) as HTMLButtonElement,
      );
      await tick();
      expect(
        container.querySelector('.cal button[aria-label="Clear date filter"]'),
      ).toBeNull();
      const cell = container.querySelector(
        '.cal-cell[aria-label="2026-04-27"]',
      ) as HTMLButtonElement;
      await fireEvent.click(cell);
      await tick();
      const clearBtn = container.querySelector(
        '.cal button[aria-label="Clear date filter"]',
      ) as HTMLButtonElement;
      expect(clearBtn).not.toBeNull();
      await fireEvent.click(clearBtn);
      await tick();
      expect(container.querySelectorAll(".cal-cell.selected")).toHaveLength(0);
      // The mode-toggle (back to text) is visible again now nothing's selected.
      expect(
        container.querySelector('.cal button[aria-label="Search by text"]'),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cal-header places the action button after the chevrons (right-aligned, mirroring text mode)", async () => {
    const { container } = await mountSidebar({ searchOpen: true });
    await fireEvent.click(
      container.querySelector(
        'button[aria-label="Filter by date"]',
      ) as HTMLButtonElement,
    );
    await tick();
    const header = container.querySelector(".cal-header") as HTMLElement;
    const children = Array.from(header.children);
    expect(children[0]?.getAttribute("aria-label")).toBe("Previous month");
    const last = children[children.length - 1];
    expect(last?.getAttribute("aria-label")).toBe("Search by text");
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
