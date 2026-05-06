// @vitest-environment jsdom

import "./testSetup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import type { OatsEvent } from "../lib/types";
import { LOCALE } from "../lib/locale";

// MeetingMeta reads only state.meeting + the live input markers off the
// store. Mock those directly so each test can dial them in without
// dragging in the rest of the store machinery.
type StoreState = {
  meeting: {
    meetingId: string;
    createdAt: string;
    scheduledStartAt?: string;
    events: OatsEvent[];
  } | null;
  firstInputAt: string | null;
  lastInputAt: string | null;
};

const storeState: StoreState = {
  meeting: null,
  firstInputAt: null,
  lastInputAt: null,
};

const setScheduledStartAt = vi.fn<(iso: string) => void>();
const clearScheduledStartAt = vi.fn<() => void>();

vi.mock("../lib/store.svelte", () => ({
  get state() {
    return storeState;
  },
  setScheduledStartAt: (iso: string) => setScheduledStartAt(iso),
  clearScheduledStartAt: () => clearScheduledStartAt(),
}));

beforeEach(() => {
  storeState.meeting = null;
  storeState.firstInputAt = null;
  storeState.lastInputAt = null;
  setScheduledStartAt.mockReset();
  clearScheduledStartAt.mockReset();
});

async function mount() {
  const MeetingMeta = (await import("./MeetingMeta.svelte")).default;
  const result = render(MeetingMeta);
  await tick();
  return result;
}

// Mirror the production fmt() formatter used to render the trigger label
// (e.g. "30 Apr 15:00"). Locale + TZ-agnostic via the same Intl path the
// component uses.
function fmt(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleString(LOCALE, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", "");
}

describe("MeetingMeta — empty meeting trigger", () => {
  it("renders an editable button labelled with the formatted scheduled time", async () => {
    storeState.meeting = {
      meetingId: "m",
      createdAt: "2026-04-30T08:00:00.000Z",
      scheduledStartAt: "2026-04-30T15:00:00.000Z",
      events: [
        {
          type: "meeting_started",
          id: "e1",
          ts: "2026-04-30T08:00:00.000Z",
          notetaker: "Tom",
        },
      ],
    };
    const { container } = await mount();

    // The trigger is a button (so a11y / keyboard activation work) with
    // the dashed-underline editable affordance class shared with
    // MeetingName / EditableLabel-styled targets.
    const trigger = container.querySelector(
      "button.ts-trigger",
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    // Label uses the human "30 Apr 15:00" format (not the native
    // datetime-local "2026-04-30T15:00" format).
    expect(trigger?.textContent?.trim()).toBe(fmt("2026-04-30T15:00:00.000Z"));
    // Calendar-clock icon stays alongside the trigger when scheduled.
    expect(container.querySelector(".scheduled-icon")).not.toBeNull();
    // No phase indicator while empty.
    expect(container.querySelector(".ellipsis")).toBeNull();
    expect(container.querySelector(".arrow")).toBeNull();
  });

  it("seeds the trigger from createdAt when no schedule is set, and hides the clock icon", async () => {
    storeState.meeting = {
      meetingId: "m",
      createdAt: "2026-04-30T08:00:00.000Z",
      events: [
        {
          type: "meeting_started",
          id: "e1",
          ts: "2026-04-30T08:00:00.000Z",
          notetaker: "Tom",
        },
      ],
    };
    const { container } = await mount();
    const trigger = container.querySelector(
      "button.ts-trigger",
    ) as HTMLButtonElement;
    expect(trigger.textContent?.trim()).toBe(fmt("2026-04-30T08:00:00.000Z"));
    expect(container.querySelector(".scheduled-icon")).toBeNull();
  });

  it("toggles the bubble open/closed on successive trigger clicks", async () => {
    storeState.meeting = {
      meetingId: "m",
      createdAt: "2026-04-30T08:00:00.000Z",
      events: [
        {
          type: "meeting_started",
          id: "e1",
          ts: "2026-04-30T08:00:00.000Z",
          notetaker: "Tom",
        },
      ],
    };
    const { container } = await mount();
    expect(container.querySelector(".datetime-bubble")).toBeNull();

    const trigger = container.querySelector(
      "button.ts-trigger",
    ) as HTMLButtonElement;
    await fireEvent.click(trigger);
    await tick();
    expect(container.querySelector(".datetime-bubble")).not.toBeNull();

    // Second click hides the bubble (toggle, not always-open).
    await fireEvent.click(trigger);
    await tick();
    expect(container.querySelector(".datetime-bubble")).toBeNull();
  });

  it("does not commit until the Schedule button is clicked", async () => {
    storeState.meeting = {
      meetingId: "m",
      createdAt: "2026-04-30T08:00:00.000Z",
      events: [
        {
          type: "meeting_started",
          id: "e1",
          ts: "2026-04-30T08:00:00.000Z",
          notetaker: "Tom",
        },
      ],
    };
    const { container } = await mount();
    const trigger = container.querySelector(
      "button.ts-trigger",
    ) as HTMLButtonElement;
    await fireEvent.click(trigger);
    await tick();

    // Picking a cell only mutates the bubble's draft.
    const cell = container.querySelector(
      ".datetime-bubble .cal-cell:not(.empty)",
    ) as HTMLButtonElement;
    await fireEvent.click(cell);
    await tick();
    expect(setScheduledStartAt).not.toHaveBeenCalled();

    // Clicking Schedule fires the store setter once.
    const schedule = container.querySelector(
      "button.schedule-btn",
    ) as HTMLButtonElement;
    expect(schedule).not.toBeNull();
    await fireEvent.click(schedule);
    expect(setScheduledStartAt).toHaveBeenCalledTimes(1);
  });

  it("clear icon button calls clearScheduledStartAt when a schedule already exists", async () => {
    storeState.meeting = {
      meetingId: "m",
      createdAt: "2026-04-30T08:00:00.000Z",
      scheduledStartAt: "2026-04-30T15:00:00.000Z",
      events: [
        {
          type: "meeting_started",
          id: "e1",
          ts: "2026-04-30T08:00:00.000Z",
          notetaker: "Tom",
        },
      ],
    };
    const { container } = await mount();
    const trigger = container.querySelector(
      "button.ts-trigger",
    ) as HTMLButtonElement;
    await fireEvent.click(trigger);
    await tick();

    // Footer should be in the "schedule exists" shape: no Schedule
    // text button, but a Clear icon button.
    expect(container.querySelector("button.schedule-btn")).toBeNull();
    const clear = container.querySelector(
      'button[aria-label="Clear scheduled time"]',
    ) as HTMLButtonElement;
    expect(clear).not.toBeNull();

    await fireEvent.click(clear);
    expect(clearScheduledStartAt).toHaveBeenCalledTimes(1);
    expect(setScheduledStartAt).not.toHaveBeenCalled();
  });

  it("removes the trigger once edits exist", async () => {
    storeState.meeting = {
      meetingId: "m",
      createdAt: "2026-04-30T08:00:00.000Z",
      events: [
        {
          type: "meeting_started",
          id: "e1",
          ts: "2026-04-30T08:00:00.000Z",
          notetaker: "Tom",
        },
        {
          type: "note_updated",
          id: "e2",
          ts: "2026-04-30T08:01:00.000Z",
          noteId: "n1",
          text: "first",
        },
      ],
    };
    const { container } = await mount();
    expect(container.querySelector("button.ts-trigger")).toBeNull();
    // Read-only timestamp is back in place.
    expect(container.querySelector(".ts")).not.toBeNull();
  });

  it("removes the trigger once live input is registered", async () => {
    storeState.meeting = {
      meetingId: "m",
      createdAt: "2026-04-30T08:00:00.000Z",
      events: [
        {
          type: "meeting_started",
          id: "e1",
          ts: "2026-04-30T08:00:00.000Z",
          notetaker: "Tom",
        },
      ],
    };
    storeState.firstInputAt = "2026-04-30T08:00:30.000Z";
    storeState.lastInputAt = "2026-04-30T08:00:30.000Z";
    const { container } = await mount();
    expect(container.querySelector("button.ts-trigger")).toBeNull();
  });
});
