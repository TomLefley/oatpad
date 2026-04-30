// @vitest-environment jsdom

import "./testSetup";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

let target: HTMLElement | null = null;

function createTarget(rect: { left: number; top: number; width: number; height: number; bottom: number }) {
  const el = document.createElement("button");
  el.textContent = "target";
  document.body.appendChild(el);
  // jsdom doesn't lay out, so synthesise a getBoundingClientRect.
  el.getBoundingClientRect = () =>
    ({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.left + rect.width,
      bottom: rect.bottom,
      toJSON: () => ({}),
    } as DOMRect);
  return el;
}

beforeEach(() => {
  target = null;
});

afterEach(() => {
  document.body.innerHTML = "";
});

async function mountCoachmark(props: {
  text?: string;
  ondismiss?: () => void;
} = {}) {
  const Coachmark = (await import("./Coachmark.svelte")).default;
  const result = render(Coachmark, {
    props: {
      getTarget: () => target,
      text: "Don't forget to add your name!",
      ondismiss: vi.fn(),
      ...props,
    },
  });
  // onMount → ResizeObserver wiring → first updatePosition.
  await tick();
  return result;
}

describe("Coachmark — positioning", () => {
  it("centres the bubble below the target horizontally and clamps to the viewport", async () => {
    target = createTarget({ left: 100, top: 50, width: 60, height: 24, bottom: 74 });
    const { container } = await mountCoachmark();
    const cm = container.querySelector(".coachmark") as HTMLElement;
    expect(cm).not.toBeNull();
    // top should be target.bottom + 8 = 82.
    expect(cm.style.top).toBe("82px");
    // left should be the centred placement, clamped to >= 8 from the edge.
    // jsdom reports body bbox as 0×0, so bodyEl.width is 0; desired = 100+30-0 = 130.
    expect(cm.style.left).toBe("130px");
  });

  it("clamps to the left when the desired position would push offscreen", async () => {
    target = createTarget({ left: -100, top: 50, width: 60, height: 24, bottom: 74 });
    const { container } = await mountCoachmark();
    const cm = container.querySelector(".coachmark") as HTMLElement;
    // Desired centre would be -70; clamped to 8 (the left margin).
    expect(cm.style.left).toBe("8px");
  });
});

describe("Coachmark — dismissal", () => {
  it("calls ondismiss when the close button is clicked", async () => {
    target = createTarget({ left: 0, top: 0, width: 10, height: 10, bottom: 10 });
    const ondismiss = vi.fn();
    const { container } = await mountCoachmark({ ondismiss });
    const close = container.querySelector(".close") as HTMLButtonElement;
    await fireEvent.click(close);
    expect(ondismiss).toHaveBeenCalledOnce();
  });

  it("calls ondismiss on Escape", async () => {
    target = createTarget({ left: 0, top: 0, width: 10, height: 10, bottom: 10 });
    const ondismiss = vi.fn();
    await mountCoachmark({ ondismiss });
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(ondismiss).toHaveBeenCalledOnce();
  });

  it("calls ondismiss when the target gains focus", async () => {
    target = createTarget({ left: 0, top: 0, width: 10, height: 10, bottom: 10 });
    const ondismiss = vi.fn();
    await mountCoachmark({ ondismiss });
    target!.dispatchEvent(new FocusEvent("focus"));
    expect(ondismiss).toHaveBeenCalledOnce();
  });

  it("ignores other key presses", async () => {
    target = createTarget({ left: 0, top: 0, width: 10, height: 10, bottom: 10 });
    const ondismiss = vi.fn();
    await mountCoachmark({ ondismiss });
    await fireEvent.keyDown(window, { key: "Enter" });
    expect(ondismiss).not.toHaveBeenCalled();
  });
});

describe("Coachmark — positioning observers", () => {
  it("recomputes position on window resize", async () => {
    target = createTarget({ left: 100, top: 50, width: 60, height: 24, bottom: 74 });
    const { container } = await mountCoachmark();
    const cm = container.querySelector(".coachmark") as HTMLElement;
    expect(cm.style.top).toBe("82px");

    // Simulate the target moving (e.g., after sidebar resize).
    target!.getBoundingClientRect = () =>
      ({
        x: 200,
        y: 100,
        width: 60,
        height: 24,
        top: 100,
        left: 200,
        right: 260,
        bottom: 124,
        toJSON: () => ({}),
      } as DOMRect);
    window.dispatchEvent(new Event("resize"));
    await tick();
    expect(cm.style.top).toBe("132px");
    expect(cm.style.left).toBe("230px");
  });
});
