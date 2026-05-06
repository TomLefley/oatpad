// @vitest-environment jsdom

import "./testSetup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import type { OatsEvent } from "../lib/types";

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

async function mount() {
  const MeetingMeta = (await import("./MeetingMeta.svelte")).default;
  const result = render(MeetingMeta);
  await tick();
  return result;
}

// Build a TZ-agnostic regex matching the locale-formatted HH:MM that
// MeetingMeta will render for an ISO string. The component formats with
// the system's local timezone, so a test running in BST will render an
// 08:00 UTC instant as 09:00. Comparing against the local-time HH:MM
// avoids that brittleness without pinning TZ globally.
function localHHMM(iso: string): RegExp {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return new RegExp(`${hh}:${mm}`);
}

describe("MeetingMeta — scheduled but not started", () => {
  it("renders the clock icon and scheduled datetime when only scheduledStartAt is set", async () => {
    storeState.meeting = {
      meetingId: "m",
      createdAt: "2026-04-30T08:00:00.000Z",
      scheduledStartAt: "2026-04-30T15:00:00.000Z",
      // Bookkeeping only — no edits.
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

    // Clock icon is present (the scheduled marker).
    expect(container.querySelector(".scheduled-icon")).not.toBeNull();
    // The visible timestamp is the scheduled time, not createdAt — this
    // matters because they differ here (08:00 created vs 15:00 scheduled).
    const ts = container.querySelector(".ts");
    expect(ts?.textContent).toMatch(localHHMM("2026-04-30T15:00:00.000Z"));
    expect(ts?.textContent).not.toMatch(localHHMM("2026-04-30T08:00:00.000Z"));
    // No phase indicator: the meeting hasn't started, so the live/idle/
    // ended ellipsis must not render.
    expect(container.querySelector(".ellipsis")).toBeNull();
    expect(container.querySelector(".arrow")).toBeNull();
  });

  it("hides the clock once an edit event arrives (no longer scheduled-only)", async () => {
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
        {
          type: "note_updated",
          id: "e2",
          ts: "2026-04-30T15:05:00.000Z",
          noteId: "n1",
          text: "first note",
        },
      ],
    };
    const { container } = await mount();

    // Once the meeting has started, the clock icon goes away — the user
    // is back in the regular live/idle/ended UI driven by edit events.
    expect(container.querySelector(".scheduled-icon")).toBeNull();
  });

  it("hides the clock once live input is registered (firstInputAt set, no events yet)", async () => {
    // Edge: the user has typed but the editor's debounced commit hasn't
    // landed any events yet. firstInputAt is the live signal that the
    // meeting is no longer "scheduled but not started".
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
    storeState.firstInputAt = "2026-04-30T15:01:00.000Z";
    storeState.lastInputAt = "2026-04-30T15:01:00.000Z";
    const { container } = await mount();

    expect(container.querySelector(".scheduled-icon")).toBeNull();
  });

  it("falls back to the existing createdAt-only behaviour when no scheduledStartAt is set", async () => {
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

    // No clock — this is just a fresh in-app meeting.
    expect(container.querySelector(".scheduled-icon")).toBeNull();
    // Timestamp is still rendered (createdAt fallback).
    const ts = container.querySelector(".ts");
    expect(ts?.textContent).toMatch(localHHMM("2026-04-30T08:00:00.000Z"));
  });
});
