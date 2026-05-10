<script lang="ts">
  import Header from "./components/Header.svelte";
  import Editor from "./components/Editor.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import GettingStarted from "./components/GettingStarted.svelte";
  import Coachmark from "./components/Coachmark.svelte";
  import DateTimeBubble from "./components/DateTimeBubble.svelte";
  import * as store from "./lib/store.svelte";
  import { editBounds } from "./lib/meetingPhase";
  import { saveFile, loadFile } from "./lib/file";
  import { isNative } from "./lib/platform";
  import { isFreshMode } from "./lib/freshMode";
  import { initUpdater, updater } from "./lib/updaterInstance.svelte";
  import { alignWithTrafficLights } from "./lib/trafficLights";
  import { initDeepLinks } from "./lib/deepLink";

  // Tauri event the in-app MCP server fires after it has just written a
  // new meeting (currently only schedule_meeting). Mirrored in
  // `src/src/lib.rs` as `MEETINGS_CHANGED_EVENT` — both ends must agree.
  const MEETINGS_CHANGED_EVENT = "oatpad://meetings-changed";

  // Kick off the boot-time update check (and version fetch) here rather
  // than from inside UpdaterRow.svelte, so the header's update-ready dot
  // can light up before the user has ever opened the settings bubble.
  // initUpdater() is idempotent and short-circuits in web mode.
  $effect(() => {
    initUpdater();
    // Measure AppKit's traffic-light position once so the header
    // centres itself against the OS-rendered chrome instead of a
    // hard-coded value. No-ops on web / non-mac native.
    alignWithTrafficLights();
  });

  // Subscribe to the Rust side's "meetings-changed" event so the
  // sidebar refreshes the moment the in-app MCP server schedules a
  // new meeting. Without this, MCP-scheduled meetings would only
  // appear at next launch. No-op on web — Tauri's event API is
  // native-only.
  $effect(() => {
    if (!isNative) return;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen(MEETINGS_CHANGED_EVENT, () => {
        void store.refreshMeetings();
      });
    })();
    return () => unlisten?.();
  });

  // Subscribe to oats:// deep links. Cold-start URLs are replayed once
  // the listener is attached; subsequent activations come through
  // onOpenUrl. No-ops on web — the plugin lives only in the .app.
  $effect(() => {
    let unlisten: (() => void) | null = null;
    void initDeepLinks({
      onMeeting: async (id) => {
        if (store.state.meeting?.meetingId === id) {
          // Already viewing it — bring focus back without thrashing the
          // editor through a flush/reload cycle.
          sidebarCollapsed = false;
          return;
        }
        await handleSwitch(id);
        sidebarCollapsed = false;
      },
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  });

  const updateReady = $derived(updater.state === "ready");
  let searchHasFilter = $state(false);

  let editor: Editor | undefined = $state();
  // Start collapsed when there's nothing in the sidebar to show — first launch
  // lands on Getting Started and the empty meeting list is just visual noise.
  // Once a meeting exists, expanding is the default.
  let sidebarCollapsed = $state(store.state.meetings.length === 0);
  let searchOpen = $state(false);
  let settingsOpen = $state(false);

  // Coachmark prompts the user to add their name. Shows whenever there's a
  // meeting in view but no notetaker set — covers both "user clicked New
  // without filling the hero input" and "app reopened with notetaker still
  // empty". Dismissal is session-only (not persisted) so a future restart
  // re-prompts if the name still isn't set.
  let coachmarkDismissed = $state(false);
  const showCoachmark = $derived(
    store.state.meeting !== null &&
      store.state.notetaker.trim() === "" &&
      !coachmarkDismissed,
  );

  $effect(() => {
    // Search and settings both live inside the sidebar; collapsing it
    // should dismiss whichever is open.
    if (sidebarCollapsed) {
      if (searchOpen) searchOpen = false;
      if (settingsOpen) settingsOpen = false;
    }
  });

  // Search and settings share the spacer slot at the top of the sidebar —
  // opening one should close the other so the bubbles don't overlap.
  function openSearch(): void {
    if (settingsOpen) settingsOpen = false;
    searchOpen = !searchOpen;
  }
  function openSettings(): void {
    if (searchOpen) searchOpen = false;
    settingsOpen = !settingsOpen;
  }

  // Schedule bubble lives at App level so opening it can push the
  // editor area down via a spacer in .main (mirrors how the sidebar's
  // bubbles spacer the meeting list). The trigger button is in
  // MeetingMeta inside the header — it just calls toggleScheduleBubble.
  let scheduleBubbleOpen = $state(false);
  // Measured by the bubble, used to size the editor's pushdown spacer
  // (plus SCHEDULE_SPACER_OVERHEAD for arrow/padding/breathing).
  let scheduleBubbleHeight = $state(0);
  const SCHEDULE_SPACER_OVERHEAD = 24;
  // One-shot wobble that runs on the editor area when the bubble closes,
  // mirroring the meeting list's settle. Cleared after WOBBLE_WINDOW_MS
  // so the keyframes can fire again on the next close.
  const SCHEDULE_WOBBLE_WINDOW_MS = 700;
  let scheduleWobbling = $state(false);
  let scheduleWobbleTimer: ReturnType<typeof setTimeout> | null = null;

  // Editing the schedule is only available while the meeting is
  // empty. Mirror MeetingMeta's `isEmpty` derivation here so App can
  // render the bubble against the same condition.
  const scheduleBounds = $derived(
    editBounds(
      store.state.meeting?.events ?? [],
      store.state.firstInputAt,
      store.state.lastInputAt,
    ),
  );
  const scheduleIsEmpty = $derived(scheduleBounds.first === null);
  const scheduleBubbleValue = $derived(
    store.state.meeting?.scheduledStartAt ??
      store.state.meeting?.createdAt ??
      "",
  );
  const scheduleHasSchedule = $derived(
    !!store.state.meeting?.scheduledStartAt,
  );

  function toggleScheduleBubble(): void {
    if (!scheduleIsEmpty) return;
    scheduleBubbleOpen = !scheduleBubbleOpen;
  }
  function closeScheduleBubble(): void {
    scheduleBubbleOpen = false;
  }
  function commitSchedule(iso: string): void {
    store.setScheduledStartAt(iso);
    scheduleBubbleOpen = false;
  }
  function clearSchedule(): void {
    store.clearScheduledStartAt();
    scheduleBubbleOpen = false;
  }

  // Flip the wobble flag whenever the bubble transitions open → closed
  // so the editor's title + body run a one-shot settle. Same pattern
  // the sidebar uses for its meeting list. prevScheduleOpen is plain
  // `let` (not $state) so the effect doesn't track its own writes.
  let prevScheduleOpen = false;
  $effect(() => {
    const justClosed = prevScheduleOpen && !scheduleBubbleOpen;
    prevScheduleOpen = scheduleBubbleOpen;
    if (!justClosed) return;
    scheduleWobbling = false;
    requestAnimationFrame(() => {
      scheduleWobbling = true;
      if (scheduleWobbleTimer) clearTimeout(scheduleWobbleTimer);
      scheduleWobbleTimer = setTimeout(() => {
        scheduleWobbling = false;
      }, SCHEDULE_WOBBLE_WINDOW_MS);
    });
  });

  // Auto-close the bubble whenever the user is no longer allowed to
  // edit the schedule (typed something, started a new meeting that's
  // since been touched, etc.).
  $effect(() => {
    if (!scheduleIsEmpty && scheduleBubbleOpen) {
      scheduleBubbleOpen = false;
    }
  });

  // Click-outside dismissal — listen on mousedown so the bubble closes
  // before any underlying click handlers fire focus shifts.
  $effect(() => {
    if (!scheduleBubbleOpen) return;
    function onDown(e: MouseEvent): void {
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest?.("[data-schedule-trigger]")) return;
      if (target.closest?.(".datetime-bubble")) return;
      scheduleBubbleOpen = false;
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  const scheduleSpacer = $derived(
    scheduleBubbleOpen
      ? Math.max(48, scheduleBubbleHeight + SCHEDULE_SPACER_OVERHEAD)
      : 0,
  );

  // The icon tray needs to clear the macOS traffic lights on its left
  // (--traffic-light-clearance, 92px in app.css) and fit four icon slots
  // with their gaps and right margin (~140px). Anything narrower pushes
  // the settings cog under the traffic-light cluster, so we pin the min
  // a little above that geometric floor. The atoms in app.css are the
  // single source of truth for the geometry; this number is hand-set to
  // sit comfortably above the computed floor.
  const MIN_W = 260;
  const MAX_W = 480;
  const LS_SIDEBAR_WIDTH = "oatpad.sidebarWidth";
  const DEFAULT_SIDEBAR_WIDTH = 280;
  function loadSidebarWidth(): number {
    if (isFreshMode) return DEFAULT_SIDEBAR_WIDTH;
    if (typeof localStorage === "undefined") return DEFAULT_SIDEBAR_WIDTH;
    const raw = localStorage.getItem(LS_SIDEBAR_WIDTH);
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_SIDEBAR_WIDTH;
    // Clamp on load too — persisted widths from before the min was
    // raised would otherwise tuck the cog behind the traffic lights.
    return Math.min(MAX_W, Math.max(MIN_W, n));
  }
  let sidebarWidth = $state(loadSidebarWidth());
  $effect(() => {
    if (isFreshMode) return;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_SIDEBAR_WIDTH, String(sidebarWidth));
    }
  });

  function startResize(e: MouseEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    document.documentElement.classList.add("resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent): void {
      sidebarWidth = Math.min(
        MAX_W,
        Math.max(MIN_W, startW + (ev.clientX - startX)),
      );
    }
    function onUp(): void {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // Also tear down on blur — covers the case where the user releases
      // the mouse outside the window or alt-tabs mid-drag, which would
      // otherwise leave the cursor / userSelect / html.resizing stuck.
      window.removeEventListener("blur", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.documentElement.classList.remove("resizing");
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
  }

  async function handleSave() {
    editor?.flush();
    const file = store.toOatsFile();
    if (!file) return;
    await saveFile(file);
  }

  async function handleOpen() {
    editor?.flush();
    if (store.hasUnsavedWork()) {
      const ok = confirm(
        "This will discard your current meeting. Continue?",
      );
      if (!ok) return;
    }
    const result = await loadFile();
    if (!result.ok) {
      if (result.reason === "invalid") {
        alert(`That file couldn't be loaded.\n\n${result.error}`);
      } else if (result.reason === "io") {
        alert(`Couldn't read that file.\n\n${result.error}`);
      }
      return;
    }
    store.replaceMeetingFromFile(result.file);
    editor?.reload();
  }

  function handleNew() {
    editor?.flush();
    // In native mode, every meeting autosaves, so no confirmation needed.
    if (!isNative && store.hasUnsavedWork()) {
      const ok = confirm("Start a new meeting? Unsaved notes will be lost.");
      if (!ok) return;
    }
    store.startNewMeeting();
    // Auto-expand the sidebar so the new meeting's row is visible — covers
    // the Getting Started CTA path where the sidebar starts collapsed.
    sidebarCollapsed = false;
    editor?.reload();
  }

  async function handleSwitch(id: string): Promise<void> {
    editor?.flush();
    await store.switchMeeting(id);
    editor?.reload();
  }

  async function handleDelete(id: string): Promise<void> {
    editor?.flush();
    await store.deleteMeetingById(id);
    // If the deleted meeting was the current one, the store has installed a
    // fresh blank meeting — reload so Quill drops the old contents and picks
    // up the empty snapshot. (For non-current deletes the editor's meeting
    // didn't change, but reload() is a cheap no-op replay of the current
    // snapshot.)
    editor?.reload();
  }
</script>

<div class="app">
  <Header
    onnew={handleNew}
    onopen={handleOpen}
    onsave={handleSave}
    {sidebarCollapsed}
    {sidebarWidth}
    ontogglesidebar={() => (sidebarCollapsed = !sidebarCollapsed)}
    {searchOpen}
    ontogglesearch={openSearch}
    {settingsOpen}
    ontogglesettings={openSettings}
    {searchHasFilter}
    {updateReady}
    {scheduleBubbleOpen}
    ontogglescheduleBubble={toggleScheduleBubble}
  />
  <div class="body">
    {#if isNative}
      <Sidebar
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        onswitch={handleSwitch}
        ondelete={handleDelete}
        {searchOpen}
        oncloseSearch={() => (searchOpen = false)}
        {settingsOpen}
        oncloseSettings={() => (settingsOpen = false)}
        bind:searchActive={searchHasFilter}
      />
    {/if}
    <div class="main">
      <!-- Schedule spacer + bubble. Spacer grows when the bubble opens
           so the editor title/body slide down out of the way; bubble is
           absolutely positioned over the spacer with its arrow at top:0
           so its visual baseline matches SearchBubble's. -->
      <div
        class="schedule-spacer"
        style:height="{scheduleSpacer}px"
      ></div>
      {#if scheduleBubbleOpen && scheduleBubbleValue}
        <DateTimeBubble
          value={scheduleBubbleValue}
          hasSchedule={scheduleHasSchedule}
          onCommit={commitSchedule}
          onClose={closeScheduleBubble}
          onClear={clearSchedule}
          bind:contentHeight={scheduleBubbleHeight}
        />
      {/if}
      {#if store.state.meeting}
        <Editor bind:this={editor} wobbling={scheduleWobbling} />
      {:else}
        <GettingStarted onnew={handleNew} onopen={handleOpen} />
      {/if}
    </div>
  </div>
  {#if isNative && !sidebarCollapsed}
    <button
      class="resize-handle"
      aria-label="Resize sidebar"
      onmousedown={startResize}
      style:left="{sidebarWidth - 6}px"
    ></button>
  {/if}
  {#if showCoachmark}
    <Coachmark
      getTarget={() =>
        document.querySelector<HTMLElement>(
          "[data-coachmark-target='notetaker']",
        )}
      text="Don't forget to add your name!"
      ondismiss={() => (coachmarkDismissed = true)}
    />
  {/if}
</div>

<style>
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .resize-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    background: transparent;
    transition: background-color 120ms ease;
    z-index: 10;
  }
  .resize-handle:hover,
  .resize-handle:active {
    background: color-mix(in srgb, var(--fg) 12%, transparent);
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .main {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  /* Pushdown spacer for the schedule bubble. Same easing as the
     sidebar's spacer so both bubbles glide on identical springs.
     Matches the editor's surface so the area revealed behind the
     bubble reads as a continuation of the page below it (without it
     the spacer would show .body's default --bg, which contrasts
     against the editor's lighter --surface). */
  .schedule-spacer {
    flex-shrink: 0;
    background: var(--surface);
    transition: height var(--anim-slide) var(--ease-spring);
  }
</style>
