<script lang="ts">
  import * as store from "../lib/store.svelte";

  type Size = "header" | "hero";
  type Props = { size?: Size };
  let { size = "header" }: Props = $props();

  let draft = $state(store.state.notetaker);
  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    const n = store.state.notetaker;
    if (n !== draft && document.activeElement !== inputEl) {
      draft = n;
    }
  });

  function commitName(): void {
    const trimmed = draft.trim();
    draft = trimmed;
    store.setNotetaker(trimmed);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      inputEl?.blur();
    } else if (e.key === "Escape") {
      draft = store.state.notetaker;
      inputEl?.blur();
    }
  }

  function handleFocus(): void {
    inputEl?.select();
  }
</script>

<h1 class="title" class:hero={size === "hero"}
  ><input
    bind:this={inputEl}
    bind:value={draft}
    class="name-input"
    placeholder="Your name"
    data-coachmark-target="notetaker"
    onkeydown={handleKeydown}
    onfocus={handleFocus}
    onblur={commitName}
  /><span class="suffix">'s </span><span class="oat-word">oat</span><span
    class="pad">pad</span>
</h1>

<style>
  .title {
    margin: 0;
    font-family:
      "Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica,
      Arial, sans-serif;
    font-size: 20px;
    font-weight: 600;
    color: var(--accent);
    line-height: 1;
    white-space: nowrap;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .title.hero {
    font-size: 44px;
  }
  .suffix,
  .oat-word,
  .pad {
    white-space: pre;
  }
  .oat-word {
    margin-left: 0.3em;
  }
  .pad {
    margin-left: 0.05em;
  }
  .name-input {
    all: unset;
    min-width: 1ch;
    field-sizing: content;
    cursor: text;
    text-decoration: underline dashed transparent;
    text-underline-offset: 0.18em;
    text-decoration-thickness: 1px;
    transition: text-decoration-color 120ms ease;
  }
  .name-input:placeholder-shown {
    text-decoration-color: var(--muted);
  }
  .name-input:hover:not(:focus) {
    text-decoration-color: var(--accent);
  }
  .name-input::placeholder {
    color: var(--muted);
    opacity: 1;
  }
</style>
