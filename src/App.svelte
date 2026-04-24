<script lang="ts">
  import Header from "./components/Header.svelte";
  import Editor from "./components/Editor.svelte";
  import * as store from "./lib/store.svelte";
  import { saveFile, loadFile } from "./lib/file";

  let editor: Editor | undefined = $state();

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
        "This will discard your current session. Continue?",
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
    if (store.hasUnsavedWork()) {
      const ok = confirm("Start a new session? Unsaved notes will be lost.");
      if (!ok) return;
    }
    store.startNewSession();
    editor?.reload();
  }
</script>

<div class="app">
  <Header onnew={handleNew} onopen={handleOpen} onsave={handleSave} />
  <div class="body">
    <Editor bind:this={editor} />
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
</style>
