// @vitest-environment jsdom

import "./testSetup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import type { OatsEvent } from "../lib/types";
import { LOCALE } from "../lib/locale";

// MeetingMeta reads only state.meeting + the live input markers off the
// store. Mock those directly so each test can dial them in without
// dragging in the rest of the store machinery. The schedule bubble
// itself lives at App level — MeetingMeta only renders the trigger
// button and reports clicks back through onToggleScheduleBubble.
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

vi.mock("../lib/store.svelte", () => ({
  get state() {
    return storeState;
  },
}));

beforeEach(() => {
  storeState.meeting = null;
  storeState.firstInputAt = null;
  storeState.lastInputAt = null;
});

async function mount(props: {
  scheduleBubbleOpen?: boolean;
  onToggleScheduleBubble?: () => void;
} = {}) {
  const MeetingMeta = (await import("./MeetingMeta.svelte")).default;
  const result = render(MeetingMeta, { props });
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

    const trigger = container.querySelector(
      "button.ts-trigger",
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent?.trim()).toBe(fmt("2026-04-30T15:00:00.000Z"));
    expect(container.querySelector(".scheduled-icon")).not.toBeNull();
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

  it("clicking the trigger calls onToggleScheduleBubble", async () => {
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
    const onToggleScheduleBubble = vi.fn();
    const { container } = await mount({ onToggleScheduleBubble });

    const trigger = container.querySelector(
      "button.ts-trigger",
    ) as HTMLButtonElement;
    await fireEvent.click(trigger);
    expect(onToggleScheduleBubble).toHaveBeenCalledTimes(1);
  });

  it("aria-expanded reflects the scheduleBubbleOpen prop", async () => {
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
    const { container, rerender } = await mount({ scheduleBubbleOpen: false });
    const trigger = container.querySelector(
      "button.ts-trigger",
    ) as HTMLButtonElement;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await rerender({ scheduleBubbleOpen: true });
    await tick();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
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
