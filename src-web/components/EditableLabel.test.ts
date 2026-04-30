// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import EditableLabel from "./EditableLabel.svelte";

describe("EditableLabel", () => {
  it("seeds the input from the initial value", () => {
    const { container } = render(EditableLabel, {
      props: { value: "hello", onCommit: vi.fn() },
    });
    const input = container.querySelector("input")!;
    expect(input.value).toBe("hello");
  });

  it("mirrors external value updates when the input is not focused", async () => {
    const { container, rerender } = render(EditableLabel, {
      props: { value: "first", onCommit: vi.fn() },
    });
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("first");

    await rerender({ value: "second", onCommit: vi.fn() });
    await tick();
    expect(input.value).toBe("second");
  });

  it("does not clobber an in-progress edit with external changes", async () => {
    const { container, rerender } = render(EditableLabel, {
      props: { value: "first", onCommit: vi.fn() },
    });
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    await fireEvent.input(input, { target: { value: "user typing" } });
    expect(input.value).toBe("user typing");

    // External update arrives mid-edit — the draft must stay put.
    await rerender({ value: "external", onCommit: vi.fn() });
    await tick();
    expect(input.value).toBe("user typing");
  });

  it("selects the input contents on focus", async () => {
    const { container } = render(EditableLabel, {
      props: { value: "select me", onCommit: vi.fn() },
    });
    const input = container.querySelector("input") as HTMLInputElement;
    const selectSpy = vi.spyOn(input, "select");
    await fireEvent.focus(input);
    expect(selectSpy).toHaveBeenCalled();
  });

  it("Enter blurs the input", async () => {
    const { container } = render(EditableLabel, {
      props: { value: "hi", onCommit: vi.fn() },
    });
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(document.activeElement).not.toBe(input);
  });

  it("Escape resets the draft to the prop value and blurs", async () => {
    const onCommit = vi.fn();
    const { container } = render(EditableLabel, {
      props: { value: "original", onCommit },
    });
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    await fireEvent.input(input, { target: { value: "draft edit" } });
    expect(input.value).toBe("draft edit");

    await fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("original");
    expect(document.activeElement).not.toBe(input);
  });

  it("blur calls onCommit with the trimmed draft", async () => {
    const onCommit = vi.fn();
    const { container } = render(EditableLabel, {
      props: { value: "", onCommit },
    });
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    await fireEvent.input(input, { target: { value: "  spaces  " } });
    await fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("spaces");
    // The draft is also normalised in-place so subsequent focus shows trimmed.
    expect(input.value).toBe("spaces");
  });

  it("forwards the dataCoachmarkTarget attribute to the input", () => {
    const { container } = render(EditableLabel, {
      props: {
        value: "x",
        onCommit: vi.fn(),
        dataCoachmarkTarget: "notetaker",
      },
    });
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("data-coachmark-target")).toBe("notetaker");
  });

  it("applies the inputClass and aria-label / placeholder props", () => {
    const { container } = render(EditableLabel, {
      props: {
        value: "x",
        onCommit: vi.fn(),
        inputClass: "title-input",
        ariaLabel: "Meeting title",
        placeholder: "Untitled",
      },
    });
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.classList.contains("title-input")).toBe(true);
    expect(input.getAttribute("aria-label")).toBe("Meeting title");
    expect(input.getAttribute("placeholder")).toBe("Untitled");
  });
});
