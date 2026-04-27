<script lang="ts">
  import Header from "./components/Header.svelte";
  import Editor from "./components/Editor.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import * as store from "./lib/store.svelte";
  import { saveFile, loadFile } from "./lib/file";
  import { isNative } from "./lib/platform";

  let editor: Editor | undefined = $state();
  let sidebarCollapsed = $state(false);

  const LS_SIDEBAR_WIDTH = "oatpad.sidebarWidth";
  function loadSidebarWidth(): number {
    if (typeof localStorage === "undefined") return 240;
    const raw = localStorage.getItem(LS_SIDEBAR_WIDTH);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 240;
  }
  let sidebarWidth = $state(loadSidebarWidth());
  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_SIDEBAR_WIDTH, String(sidebarWidth));
    }
  });

  const MIN_W = 200;
  const MAX_W = 480;

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
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.documentElement.classList.remove("resizing");
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
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
    store.replaceSessionFromFile(result.file);
    editor?.reload();
  }

  function handleNew() {
    editor?.flush();
    // In native mode, every meeting autosaves, so no confirmation needed.
    if (!isNative && store.hasUnsavedWork()) {
      const ok = confirm("Start a new meeting? Unsaved notes will be lost.");
      if (!ok) return;
    }
    store.startNewSession();
    editor?.reload();
  }

  async function handleSwitch(id: string): Promise<void> {
    editor?.flush();
    await store.switchSession(id);
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
  />
  <div class="body">
    {#if isNative}
      <Sidebar
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        onswitch={handleSwitch}
      />
    {/if}
    <div class="main">
      <Editor bind:this={editor} />
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
