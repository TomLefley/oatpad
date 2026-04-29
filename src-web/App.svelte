<script lang="ts">
  import Header from "./components/Header.svelte";
  import Editor from "./components/Editor.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import GettingStarted from "./components/GettingStarted.svelte";
  import Coachmark from "./components/Coachmark.svelte";
  import * as store from "./lib/store.svelte";
  import { saveFile, loadFile } from "./lib/file";
  import { isNative } from "./lib/platform";
  import { isFreshMode } from "./lib/freshMode";

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

  // The icon tray needs to clear the macOS traffic lights on its left
  // (92px of left-col padding) and fit four 32px icon slots with their
  // gaps and the right margin (~140px). Anything narrower pushes the
  // settings cog under the traffic light cluster, so we pin the min
  // a little above that geometric floor.
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
      />
    {/if}
    <div class="main">
      {#if store.state.meeting}
        <Editor bind:this={editor} />
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
      targetSelector="[data-coachmark-target='notetaker']"
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
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
</style>
