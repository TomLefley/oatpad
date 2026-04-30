// Pure-logic state machine driving the in-app updater UI. UpdaterRow.svelte
// instantiates one of these with real Tauri-plugin deps; tests instantiate
// one with mocked deps to drive every transition without hitting GitHub or
// touching the filesystem.

export type UpdateState =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "restarting";

export type UpdateHandle = {
  version: string;
  download: (timeoutMs: number) => Promise<void>;
  install: () => Promise<void>;
};

export type UpdaterDeps = {
  // Returns the update handle, or null if there is no update available.
  check: (timeoutMs: number) => Promise<UpdateHandle | null>;
  relaunch: () => Promise<void>;
  delay: (ms: number) => Promise<void>;
  log: (msg: string, err?: unknown) => void;
};

export type UpdaterTimings = {
  checkTimeoutMs: number;
  downloadTimeoutMs: number;
  minSpinMs: number;
};

export class UpdaterMachine {
  state = $state<UpdateState>("idle");
  pendingVersion = $state<string | null>(null);
  // True only when there is an in-flight check the user is watching —
  // either they clicked the button, or they clicked it after a silent
  // background check had already started. Spinner visibility hangs off
  // this flag so background activity stays invisible.
  userInitiatedCheck = $state(false);

  #pending: UpdateHandle | null = null;
  #deps: UpdaterDeps;
  #timings: UpdaterTimings;

  constructor(deps: UpdaterDeps, timings: UpdaterTimings) {
    this.#deps = deps;
    this.#timings = timings;
  }

  // Single entry point for both the auto-check on mount and the manual
  // "Check for updates" button click. Per-call `timeout` bounds a stalled
  // GitHub fetch so the spinner can't hang forever (corporate proxy, TLS
  // stall, network drop). Any error drops us back to `idle` and surfaces
  // in the log for diagnosis.
  async runCheck(): Promise<void> {
    if (this.state !== "idle") return;
    this.state = "checking";
    // A fast cache hit can return in <100ms, which makes the spinner
    // strobe rather than spin. minSpin floors the animation so there's
    // always at least half a turn visible — but only when the user is
    // watching (background checks aren't gated by it).
    const minSpin = this.#deps.delay(this.#timings.minSpinMs);
    try {
      const handle = await this.#deps.check(this.#timings.checkTimeoutMs);
      if (this.userInitiatedCheck) await minSpin;
      if (!handle) {
        this.state = "idle";
        return;
      }
      this.#pending = handle;
      this.pendingVersion = handle.version;
      this.state = "downloading";
      await handle.download(this.#timings.downloadTimeoutMs);
      this.state = "ready";
    } catch (e) {
      if (this.userInitiatedCheck) await minSpin;
      this.#deps.log("[oatpad updater]", e);
      this.#pending = null;
      this.pendingVersion = null;
      this.state = "idle";
    } finally {
      // The spinner only matters while the activity is visible.
      // Resetting here covers both "user clicked, check finished" and
      // "user joined a bg check that then finished".
      this.userInitiatedCheck = false;
    }
  }

  // Two awaits, two distinct failure modes: install can fail (bundle
  // corrupt, FS permission, plugin error) but if it succeeds the new
  // build is on disk and re-running install would either no-op or
  // double-write. Distinguish them so a relaunch failure doesn't
  // strand the user on a "Restart to update" button that would
  // attempt to install again.
  async restart(): Promise<void> {
    if (!this.#pending) return;
    this.state = "restarting";
    try {
      await this.#pending.install();
    } catch (e) {
      this.#deps.log("[oatpad updater] install failed", e);
      this.state = "ready";
      return;
    }
    try {
      await this.#deps.relaunch();
    } catch (e) {
      // Install succeeded — the next launch will already be the new
      // version. Drop the in-memory pending so the button reverts to
      // "Check for updates" rather than re-prompting a restart.
      this.#deps.log("[oatpad updater] relaunch failed", e);
      this.#pending = null;
      this.pendingVersion = null;
      this.state = "idle";
    }
  }

  click(): void {
    if (this.state === "ready") {
      void this.restart();
      return;
    }
    // Either start a fresh check, or just promote an in-flight
    // background check to a visible one (so the spinner appears from
    // here on out without spawning a duplicate request).
    this.userInitiatedCheck = true;
    if (this.state === "idle") {
      void this.runCheck();
    }
  }

  // Spinner only animates when the user is watching — background
  // auto-checks stay invisible.
  get spinning(): boolean {
    return (
      this.userInitiatedCheck &&
      (this.state === "checking" || this.state === "downloading")
    );
  }

  // Disable the button when there's user-visible activity (avoid
  // double-clicks) or while restart is in flight.
  get busy(): boolean {
    return this.spinning || this.state === "restarting";
  }
}
