import { describe, it, expect, vi } from "vitest";
import {
  UpdaterMachine,
  type UpdateHandle,
  type UpdaterDeps,
  type UpdaterTimings,
} from "./updater.svelte";

const TIMINGS: UpdaterTimings = {
  checkTimeoutMs: 30_000,
  downloadTimeoutMs: 5 * 60_000,
  minSpinMs: 500,
};

// Default deps with no-op delay so timing-sensitive paths run instantly.
function makeDeps(overrides: Partial<UpdaterDeps> = {}): UpdaterDeps {
  return {
    check: vi.fn(async () => null),
    relaunch: vi.fn(async () => {}),
    delay: vi.fn(() => Promise.resolve()),
    log: vi.fn(),
    ...overrides,
  };
}

function makeHandle(version: string, overrides: Partial<UpdateHandle> = {}): UpdateHandle {
  return {
    version,
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("UpdaterMachine.runCheck", () => {
  it("starts idle", () => {
    const m = new UpdaterMachine(makeDeps(), TIMINGS);
    expect(m.state).toBe("idle");
    expect(m.pendingVersion).toBeNull();
  });

  it("returns to idle when check resolves with no update", async () => {
    const m = new UpdaterMachine(makeDeps(), TIMINGS);
    await m.runCheck();
    expect(m.state).toBe("idle");
    expect(m.pendingVersion).toBeNull();
  });

  it("transitions checking → downloading → ready when an update is available", async () => {
    const handle = makeHandle("1.2.3");
    const deps = makeDeps({ check: async () => handle });
    const m = new UpdaterMachine(deps, TIMINGS);
    await m.runCheck();
    expect(m.state).toBe("ready");
    expect(m.pendingVersion).toBe("1.2.3");
    expect(handle.download).toHaveBeenCalledOnce();
  });

  it("falls back to idle when check throws", async () => {
    const deps = makeDeps({
      check: async () => {
        throw new Error("network down");
      },
    });
    const m = new UpdaterMachine(deps, TIMINGS);
    await m.runCheck();
    expect(m.state).toBe("idle");
    expect(m.pendingVersion).toBeNull();
    expect(deps.log).toHaveBeenCalled();
  });

  it("falls back to idle when download throws", async () => {
    const deps = makeDeps({
      check: async () =>
        makeHandle("2.0.0", {
          download: async () => {
            throw new Error("disk full");
          },
        }),
    });
    const m = new UpdaterMachine(deps, TIMINGS);
    await m.runCheck();
    expect(m.state).toBe("idle");
    expect(m.pendingVersion).toBeNull();
  });

  it("is a no-op when state is not idle", async () => {
    const deps = makeDeps();
    const m = new UpdaterMachine(deps, TIMINGS);
    // Force state to a non-idle value and re-run; the check fn must
    // not be called.
    m.state = "checking";
    await m.runCheck();
    expect(deps.check).not.toHaveBeenCalled();
  });

  it("resets userInitiatedCheck after a successful path", async () => {
    const m = new UpdaterMachine(makeDeps(), TIMINGS);
    m.userInitiatedCheck = true;
    await m.runCheck();
    expect(m.userInitiatedCheck).toBe(false);
  });

  it("resets userInitiatedCheck after an error path", async () => {
    const m = new UpdaterMachine(
      makeDeps({
        check: async () => {
          throw new Error("nope");
        },
      }),
      TIMINGS,
    );
    m.userInitiatedCheck = true;
    await m.runCheck();
    expect(m.userInitiatedCheck).toBe(false);
  });

  it("waits for minSpin only when userInitiatedCheck is true", async () => {
    const delay = vi.fn(() => Promise.resolve());
    const m = new UpdaterMachine(makeDeps({ delay }), TIMINGS);
    await m.runCheck();
    // delay was set up at the start of runCheck regardless, but we never
    // awaited it because userInitiatedCheck was false.
    expect(delay).toHaveBeenCalledWith(TIMINGS.minSpinMs);
    // The minSpin promise was created (delay called once), but the
    // state-flow didn't wait on it (we get here synchronously after the
    // check resolves). We can't directly observe "didn't await" without
    // ordering instrumentation; the next test pins the user-initiated
    // path, where the await *is* observable.
  });

  it("awaits minSpin in the user-initiated success path", async () => {
    let releaseDelay: (() => void) | null = null;
    const delayPromise = new Promise<void>((r) => {
      releaseDelay = r;
    });
    const handle = makeHandle("1.0.0");
    const m = new UpdaterMachine(
      makeDeps({
        delay: () => delayPromise,
        check: async () => handle,
      }),
      TIMINGS,
    );
    m.userInitiatedCheck = true;
    const run = m.runCheck();
    // Yield so the check() resolves and we land at the minSpin gate.
    await Promise.resolve();
    await Promise.resolve();
    // The check has resolved but minSpin hasn't, so we should still
    // be in "checking" — not yet "downloading".
    expect(m.state).toBe("checking");
    releaseDelay!();
    await run;
    expect(m.state).toBe("ready");
  });
});

describe("UpdaterMachine.restart", () => {
  it("is a no-op when no update is pending", async () => {
    const deps = makeDeps();
    const m = new UpdaterMachine(deps, TIMINGS);
    await m.restart();
    expect(m.state).toBe("idle");
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it("install + relaunch happy path leaves state at restarting", async () => {
    const handle = makeHandle("1.0.0");
    const deps = makeDeps({ check: async () => handle });
    const m = new UpdaterMachine(deps, TIMINGS);
    await m.runCheck();
    expect(m.state).toBe("ready");
    await m.restart();
    // The process exits before we get further; the machine reports
    // "restarting" because that's the last assigned state.
    expect(m.state).toBe("restarting");
    expect(handle.install).toHaveBeenCalledOnce();
    expect(deps.relaunch).toHaveBeenCalledOnce();
  });

  it("install failure returns to ready and does not call relaunch", async () => {
    const handle = makeHandle("1.0.0", {
      install: async () => {
        throw new Error("bundle corrupt");
      },
    });
    const deps = makeDeps({ check: async () => handle });
    const m = new UpdaterMachine(deps, TIMINGS);
    await m.runCheck();
    await m.restart();
    expect(m.state).toBe("ready");
    expect(deps.relaunch).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("install failed"),
      expect.any(Error),
    );
  });

  it("install success but relaunch failure drops pending and returns to idle", async () => {
    const handle = makeHandle("1.0.0");
    const deps = makeDeps({
      check: async () => handle,
      relaunch: async () => {
        throw new Error("process plugin exploded");
      },
    });
    const m = new UpdaterMachine(deps, TIMINGS);
    await m.runCheck();
    await m.restart();
    expect(m.state).toBe("idle");
    expect(m.pendingVersion).toBeNull();
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("relaunch failed"),
      expect.any(Error),
    );
  });
});

describe("UpdaterMachine.click", () => {
  it("starts a fresh check when idle, marking it user-initiated", async () => {
    const handle = makeHandle("1.0.0");
    const deps = makeDeps({ check: async () => handle });
    const m = new UpdaterMachine(deps, TIMINGS);
    m.click();
    expect(m.userInitiatedCheck).toBe(true);
    // Wait for the async chain to settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(m.state).toBe("ready");
  });

  it("promotes a background check to user-initiated without spawning a duplicate", async () => {
    const checkFn = vi.fn(async () => null);
    const m = new UpdaterMachine(makeDeps({ check: checkFn }), TIMINGS);
    // Kick off a "background" check (userInitiatedCheck stays false).
    const run = m.runCheck();
    expect(m.state).toBe("checking");
    expect(m.userInitiatedCheck).toBe(false);
    // User clicks while the check is in flight.
    m.click();
    expect(m.userInitiatedCheck).toBe(true);
    expect(checkFn).toHaveBeenCalledOnce();
    await run;
  });

  it("triggers restart when ready", async () => {
    const handle = makeHandle("1.0.0");
    const deps = makeDeps({ check: async () => handle });
    const m = new UpdaterMachine(deps, TIMINGS);
    await m.runCheck();
    expect(m.state).toBe("ready");
    m.click();
    expect(m.state).toBe("restarting");
  });
});

describe("UpdaterMachine derived flags", () => {
  it("spinning is true only during user-initiated checking/downloading", async () => {
    const m = new UpdaterMachine(makeDeps(), TIMINGS);
    expect(m.spinning).toBe(false);
    m.state = "checking";
    expect(m.spinning).toBe(false); // still false — not user-initiated
    m.userInitiatedCheck = true;
    expect(m.spinning).toBe(true);
    m.state = "downloading";
    expect(m.spinning).toBe(true);
    m.state = "ready";
    expect(m.spinning).toBe(false);
  });

  it("busy covers spinning + restarting", async () => {
    const m = new UpdaterMachine(makeDeps(), TIMINGS);
    expect(m.busy).toBe(false);
    m.state = "restarting";
    expect(m.busy).toBe(true);
    m.state = "checking";
    m.userInitiatedCheck = true;
    expect(m.busy).toBe(true);
    m.userInitiatedCheck = false;
    expect(m.busy).toBe(false);
  });
});
