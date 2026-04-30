// App-wide singleton for the update flow. The machine itself was created
// inside UpdaterRow.svelte, but its lifecycle is "settings bubble open"
// — meaning the auto-check never ran unless the user opened settings,
// and the header's update-ready dot couldn't see anything until they did.
// Hoisting the instance here gives the dot a signal it can read at any
// time and lets the auto-check run once at app boot.

import { getVersion as tauriGetVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isNative } from "./platform";
import { UpdaterMachine, type UpdateHandle } from "./updater.svelte";

function tauriCheck(timeoutMs: number): Promise<UpdateHandle | null> {
  return check({ timeout: timeoutMs }).then((u: Update | null) =>
    u
      ? {
          version: u.version,
          download: (t: number) => u.download(undefined, { timeout: t }),
          install: () => u.install(),
        }
      : null,
  );
}

export const updater = new UpdaterMachine(
  {
    check: tauriCheck,
    relaunch,
    delay: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    log: (msg, err) => console.error(msg, err),
  },
  {
    checkTimeoutMs: 30_000,
    downloadTimeoutMs: 5 * 60_000,
    minSpinMs: 500,
  },
);

// Wrapped in an object because module-level reactive primitives need a
// container — the same pattern store.svelte.ts uses for its top-level state.
export const versionState = $state<{ value: string | null }>({ value: null });

let initialized = false;

export function initUpdater(): void {
  if (initialized) return;
  initialized = true;
  if (!isNative) return;
  void tauriGetVersion()
    .then((v) => {
      versionState.value = v;
    })
    .catch(() => {
      // Hide the version line on any failure — it's a footnote, not
      // load-bearing.
    });
  // Background auto-check at app boot. Cheap and silent —
  // userInitiatedCheck stays false, so the spinner doesn't show.
  void updater.runCheck();
}

// Test-only: reset the singleton's observable state so tests can pretend
// they're the first to import this module. Production callers don't need
// this — initUpdater() is idempotent.
export function resetForTest(): void {
  updater.reset();
  versionState.value = null;
  initialized = false;
}
