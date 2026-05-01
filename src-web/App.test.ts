// @vitest-environment jsdom

import "./components/testSetup";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import type { OatsEvent, QuillDelta } from "./lib/types";

type StoreMeeting = {
  meetingId: string;
  notetaker: string;
  title: string;
  createdAt: string;
  events: OatsEvent[];
  snapshot: QuillDelta;
  paragraphIds: string[];
};

const storeState: {
  meeting: StoreMeeting | null;
  meetings: { meetingId: string; title: string; createdAt: string }[];
  notetaker: string;
} = { meeting: null, meetings: [], notetaker: "" };

const startNewMeeting = vi.fn();
const switchMeeting = vi.fn(async () => {});
const deleteMeetingById = vi.fn(async () => {});
const replaceMeetingFromFile = vi.fn();
const hasUnsavedWork = vi.fn(() => false);
const toOatsFile = vi.fn(() => null);

vi.mock("./lib/store.svelte", () => ({
  get state() {
    return storeState;
  },
  startNewMeeting,
  switchMeeting,
  deleteMeetingById,
  replaceMeetingFromFile,
  hasUnsavedWork,
  toOatsFile,
  setNotetaker: vi.fn(),
  setTitle: vi.fn(),
  appendEvents: vi.fn(),
  setSnapshot: vi.fn(),
  noteInput: vi.fn(),
  registerEditorFlush: vi.fn(),
  unregisterEditorFlush: vi.fn(),
}));

let isNativeFlag = false;
vi.mock("./lib/platform", () => ({
  get isNative() {
    return isNativeFlag;
  },
  get isWeb() {
    return !isNativeFlag;
  },
}));

const saveFile = vi.fn(async () => true);
const loadFile = vi.fn<() => Promise<unknown>>(async () => ({
  ok: false,
  reason: "cancelled",
}));
vi.mock("./lib/file", () => ({
  saveFile: () => saveFile(),
  loadFile: () => loadFile(),
}));

// Children that pull Tauri imports — stub them out at module load.
vi.mock("./lib/config", () => ({
  loadConfig: vi.fn().mockResolvedValue({ mcpEnabled: true, mcpInstalled: false }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.0.0"),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

beforeEach(() => {
  storeState.meeting = null;
  storeState.meetings = [];
  storeState.notetaker = "";
  isNativeFlag = false;
  localStorage.clear();
  startNewMeeting.mockReset();
  switchMeeting.mockReset();
  deleteMeetingById.mockReset();
  replaceMeetingFromFile.mockReset();
  hasUnsavedWork.mockReset().mockReturnValue(false);
  toOatsFile.mockReset();
  saveFile.mockReset().mockResolvedValue(true);
  loadFile.mockReset().mockResolvedValue({ ok: false, reason: "cancelled" });
});

async function mountApp() {
  const App = (await import("./App.svelte")).default;
  const result = render(App);
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await tick();
  }
  return result;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("App — sidebar width persistence", () => {
  it("clamps a persisted width below MIN_W up to MIN_W", async () => {
    isNativeFlag = true;
    storeState.meeting = {
      meetingId: "m",
      notetaker: "",
      title: "",
      createdAt: "2026-04-30T10:00:00.000Z",
      events: [],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    storeState.meetings = [
      { meetingId: "m", title: "M", createdAt: "2026-04-30T10:00:00.000Z" },
    ];
    // Below MIN_W (260) — should clamp on load.
    localStorage.setItem("oatpad.sidebarWidth", "100");
    const { container } = await mountApp();
    // The resize handle's left position is sidebarWidth - 6 once mounted.
    const handle = container.querySelector(".resize-handle") as HTMLElement;
    expect(handle).not.toBeNull();
    const left = handle.style.left;
    // 260 - 6 = 254px.
    expect(left).toBe("254px");
  });

  it("clamps a persisted width above MAX_W down to MAX_W", async () => {
    isNativeFlag = true;
    storeState.meeting = {
      meetingId: "m",
      notetaker: "",
      title: "",
      createdAt: "2026-04-30T10:00:00.000Z",
      events: [],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    storeState.meetings = [
      { meetingId: "m", title: "M", createdAt: "2026-04-30T10:00:00.000Z" },
    ];
    localStorage.setItem("oatpad.sidebarWidth", "9999");
    const { container } = await mountApp();
    const handle = container.querySelector(".resize-handle") as HTMLElement;
    expect(handle).not.toBeNull();
    // MAX_W = 480; handle left = 480 - 6 = 474.
    expect(handle.style.left).toBe("474px");
  });

  it("writes the current sidebar width to localStorage on change", async () => {
    isNativeFlag = true;
    storeState.meeting = {
      meetingId: "m",
      notetaker: "",
      title: "",
      createdAt: "2026-04-30T10:00:00.000Z",
      events: [],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    storeState.meetings = [
      { meetingId: "m", title: "M", createdAt: "2026-04-30T10:00:00.000Z" },
    ];
    await mountApp();
    // The $effect runs on mount and writes the resolved (default) width.
    const persisted = localStorage.getItem("oatpad.sidebarWidth");
    // 280 is DEFAULT_SIDEBAR_WIDTH.
    expect(persisted).toBe("280");
  });
});

describe("App — sidebar resize handle drag", () => {
  it("clamps a wide drag to MAX_W", async () => {
    isNativeFlag = true;
    storeState.meeting = {
      meetingId: "m",
      notetaker: "",
      title: "",
      createdAt: "2026-04-30T10:00:00.000Z",
      events: [],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    storeState.meetings = [
      { meetingId: "m", title: "M", createdAt: "2026-04-30T10:00:00.000Z" },
    ];
    const { container } = await mountApp();
    const handle = container.querySelector(".resize-handle") as HTMLElement;
    expect(handle).not.toBeNull();

    // Start a drag at clientX=300, then drag to clientX=10000.
    await fireEvent.mouseDown(handle, { clientX: 300 });
    await fireEvent.mouseMove(document, { clientX: 10000 });
    await fireEvent.mouseUp(document);
    await tick();
    // Width should clamp at MAX_W (480) → handle left = 474.
    expect(handle.style.left).toBe("474px");
  });

  it("clamps a narrow drag to MIN_W", async () => {
    isNativeFlag = true;
    storeState.meeting = {
      meetingId: "m",
      notetaker: "",
      title: "",
      createdAt: "2026-04-30T10:00:00.000Z",
      events: [],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    storeState.meetings = [
      { meetingId: "m", title: "M", createdAt: "2026-04-30T10:00:00.000Z" },
    ];
    const { container } = await mountApp();
    const handle = container.querySelector(".resize-handle") as HTMLElement;
    await fireEvent.mouseDown(handle, { clientX: 300 });
    await fireEvent.mouseMove(document, { clientX: -10000 });
    await fireEvent.mouseUp(document);
    await tick();
    // Width clamps at MIN_W (260) → handle left = 254.
    expect(handle.style.left).toBe("254px");
  });
});

describe("App — coachmark visibility", () => {
  it("shows the coachmark when a meeting exists and notetaker is empty", async () => {
    storeState.meeting = {
      meetingId: "m",
      notetaker: "",
      title: "",
      createdAt: "2026-04-30T10:00:00.000Z",
      events: [],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    storeState.notetaker = "";
    const { container } = await mountApp();
    expect(container.querySelector(".coachmark")).not.toBeNull();
  });

  it("hides the coachmark once notetaker is non-empty", async () => {
    storeState.meeting = {
      meetingId: "m",
      notetaker: "alice",
      title: "",
      createdAt: "2026-04-30T10:00:00.000Z",
      events: [],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    storeState.notetaker = "alice";
    const { container } = await mountApp();
    expect(container.querySelector(".coachmark")).toBeNull();
  });

  it("hides the coachmark when there is no meeting (Getting Started view)", async () => {
    storeState.meeting = null;
    storeState.notetaker = "";
    const { container } = await mountApp();
    expect(container.querySelector(".coachmark")).toBeNull();
  });

  it("dismissing the coachmark hides it for the rest of the session", async () => {
    storeState.meeting = {
      meetingId: "m",
      notetaker: "",
      title: "",
      createdAt: "2026-04-30T10:00:00.000Z",
      events: [],
      snapshot: { ops: [{ insert: "\n" }] },
      paragraphIds: [],
    };
    const { container } = await mountApp();
    const dismiss = container.querySelector(
      '.coachmark .close',
    ) as HTMLButtonElement;
    expect(dismiss).not.toBeNull();
    await fireEvent.click(dismiss);
    await tick();
    expect(container.querySelector(".coachmark")).toBeNull();
  });
});
