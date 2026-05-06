// @vitest-environment jsdom

import "./testSetup";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

async function mount(props: {
  value: string;
  hasSchedule?: boolean;
  onCommit?: (iso: string) => void;
  onClose?: () => void;
  onClear?: () => void;
}) {
  const DateTimeBubble = (await import("./DateTimeBubble.svelte")).default;
  const result = render(DateTimeBubble, {
    props: {
      hasSchedule: false,
      onCommit: vi.fn(),
      onClose: vi.fn(),
      onClear: vi.fn(),
      ...props,
    },
  });
  await tick();
  return result;
}

describe("DateTimeBubble — initial render", () => {
  it("renders a calendar grid for the seeded month and a time field initialised to the seeded time", async () => {
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
    });
    const month = container.querySelector(".cal-month-label");
    expect(month?.textContent).toMatch(/April 2026/);

    const time = container.querySelector(
      "input[type='time']",
    ) as HTMLInputElement;
    expect(time).not.toBeNull();
    const d = new Date("2026-04-15T13:30:00.000Z");
    const pad = (n: number): string => String(n).padStart(2, "0");
    expect(time.value).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}`);

    const selected = container.querySelector(".cal-cell.selected");
    expect(selected?.textContent?.trim()).toBe(String(d.getDate()));
  });
});

describe("DateTimeBubble — deferred commit", () => {
  it("clicking a calendar cell updates the draft selection but does not commit", async () => {
    const onCommit = vi.fn();
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      onCommit,
    });
    const cells = container.querySelectorAll(
      ".cal-cell:not(.empty)",
    ) as NodeListOf<HTMLButtonElement>;
    const twentieth = Array.from(cells).find(
      (c) => c.textContent?.trim() === "20",
    ) as HTMLButtonElement;
    await fireEvent.click(twentieth);
    await tick();

    expect(onCommit).not.toHaveBeenCalled();
    // The draft selection moved to the 20th — visual feedback for the
    // user even though we haven't committed yet.
    expect(
      container.querySelector(".cal-cell.selected")?.textContent?.trim(),
    ).toBe("20");
  });

  it("changing the time field updates the draft but does not commit", async () => {
    const onCommit = vi.fn();
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      onCommit,
    });
    const time = container.querySelector(
      "input[type='time']",
    ) as HTMLInputElement;
    await fireEvent.change(time, { target: { value: "09:45" } });
    await tick();

    expect(onCommit).not.toHaveBeenCalled();
    expect(time.value).toBe("09:45");
  });

  it("clicking Schedule commits the combined draft (date + time) once", async () => {
    const onCommit = vi.fn();
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      hasSchedule: false,
      onCommit,
    });
    const time = container.querySelector(
      "input[type='time']",
    ) as HTMLInputElement;
    await fireEvent.change(time, { target: { value: "09:45" } });
    const cells = container.querySelectorAll(
      ".cal-cell:not(.empty)",
    ) as NodeListOf<HTMLButtonElement>;
    const twentieth = Array.from(cells).find(
      (c) => c.textContent?.trim() === "20",
    ) as HTMLButtonElement;
    await fireEvent.click(twentieth);
    await tick();
    expect(onCommit).not.toHaveBeenCalled();

    const schedule = container.querySelector(
      "button.schedule-btn",
    ) as HTMLButtonElement;
    expect(schedule).not.toBeNull();
    expect(schedule.textContent).toMatch(/Schedule/);
    await fireEvent.click(schedule);

    expect(onCommit).toHaveBeenCalledTimes(1);
    const [iso] = onCommit.mock.calls[0];
    const d = new Date(iso);
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(45);
  });
});

describe("DateTimeBubble — footer when a schedule already exists", () => {
  it("replaces the Schedule button with Update + Clear icon buttons", async () => {
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      hasSchedule: true,
    });
    expect(container.querySelector("button.schedule-btn")).toBeNull();
    expect(
      container.querySelector('button[aria-label="Update scheduled time"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Clear scheduled time"]'),
    ).not.toBeNull();
  });

  it("Update commits the current draft", async () => {
    const onCommit = vi.fn();
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      hasSchedule: true,
      onCommit,
    });
    const time = container.querySelector(
      "input[type='time']",
    ) as HTMLInputElement;
    await fireEvent.change(time, { target: { value: "09:45" } });
    await tick();

    const update = container.querySelector(
      'button[aria-label="Update scheduled time"]',
    ) as HTMLButtonElement;
    await fireEvent.click(update);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [iso] = onCommit.mock.calls[0];
    const d = new Date(iso);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(45);
  });

  it("Clear fires onClear (and not onCommit)", async () => {
    const onCommit = vi.fn();
    const onClear = vi.fn();
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      hasSchedule: true,
      onCommit,
      onClear,
    });
    const clear = container.querySelector(
      'button[aria-label="Clear scheduled time"]',
    ) as HTMLButtonElement;
    await fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("DateTimeBubble — dirty indicators", () => {
  it("time input is not flagged changed and Update has no dot on initial render", async () => {
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      hasSchedule: true,
    });
    const time = container.querySelector(
      "input[type='time']",
    ) as HTMLInputElement;
    expect(time.classList.contains("changed")).toBe(false);
    const update = container.querySelector(
      'button[aria-label="Update scheduled time"]',
    ) as HTMLButtonElement;
    expect(update.querySelector(".dot")).toBeNull();
  });

  it("changing the time adds the .changed class and a .dot on Update", async () => {
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      hasSchedule: true,
    });
    const time = container.querySelector(
      "input[type='time']",
    ) as HTMLInputElement;
    await fireEvent.change(time, { target: { value: "09:45" } });
    await tick();

    expect(time.classList.contains("changed")).toBe(true);
    const update = container.querySelector(
      'button[aria-label="Update scheduled time"]',
    ) as HTMLButtonElement;
    expect(update.querySelector(".dot")).not.toBeNull();
  });

  it("returning the time to the seeded value drops the .changed class", async () => {
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      hasSchedule: true,
    });
    const time = container.querySelector(
      "input[type='time']",
    ) as HTMLInputElement;
    const seedValue = time.value;
    await fireEvent.change(time, { target: { value: "09:45" } });
    await tick();
    expect(time.classList.contains("changed")).toBe(true);

    await fireEvent.change(time, { target: { value: seedValue } });
    await tick();
    expect(time.classList.contains("changed")).toBe(false);
  });

  it("changing only the date adds .dot on Update but leaves the time input unflagged", async () => {
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      hasSchedule: true,
    });
    const cells = container.querySelectorAll(
      ".cal-cell:not(.empty)",
    ) as NodeListOf<HTMLButtonElement>;
    const twentieth = Array.from(cells).find(
      (c) => c.textContent?.trim() === "20",
    ) as HTMLButtonElement;
    await fireEvent.click(twentieth);
    await tick();

    const update = container.querySelector(
      'button[aria-label="Update scheduled time"]',
    ) as HTMLButtonElement;
    expect(update.querySelector(".dot")).not.toBeNull();
    const time = container.querySelector(
      "input[type='time']",
    ) as HTMLInputElement;
    // The time itself wasn't touched, so its highlight stays off — only
    // the field that changed should be flagged.
    expect(time.classList.contains("changed")).toBe(false);
  });

  it("dirty dot also appears on the Schedule button when no schedule exists yet", async () => {
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      hasSchedule: false,
    });
    const time = container.querySelector(
      "input[type='time']",
    ) as HTMLInputElement;
    await fireEvent.change(time, { target: { value: "09:45" } });
    await tick();

    const schedule = container.querySelector(
      "button.schedule-btn",
    ) as HTMLButtonElement;
    expect(schedule.querySelector(".dot")).not.toBeNull();
  });
});

describe("DateTimeBubble — month nav + Escape", () => {
  it("month nav shifts the calendar without committing", async () => {
    const onCommit = vi.fn();
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      onCommit,
    });
    const next = container.querySelector(
      'button[aria-label="Next month"]',
    ) as HTMLButtonElement;
    await fireEvent.click(next);
    await tick();
    expect(container.querySelector(".cal-month-label")?.textContent).toMatch(
      /May 2026/,
    );
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape inside the bubble fires onClose", async () => {
    const onClose = vi.fn();
    const { container } = await mount({
      value: "2026-04-15T13:30:00.000Z",
      onClose,
    });
    const bubble = container.querySelector(
      ".datetime-bubble",
    ) as HTMLElement;
    await fireEvent.keyDown(bubble, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
