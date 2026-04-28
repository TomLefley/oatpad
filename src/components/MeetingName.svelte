<script lang="ts">
  import * as store from "../lib/store.svelte";

  let draft = $state(store.state.meeting?.title ?? "");
  let inputEl: HTMLInputElement | undefined = $state();

  // Keep local draft aligned with the store when the user isn't actively
  // editing — covers meeting switches and autosave-driven title changes.
  $effect(() => {
    const t = store.state.meeting?.title ?? "";
    if (t !== draft && document.activeElement !== inputEl) {
      draft = t;
    }
  });

  function commit(): void {
    const trimmed = draft.trim();
    draft = trimmed;
    store.setTitle(trimmed);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      inputEl?.blur();
    } else if (e.key === "Escape") {
      draft = store.state.meeting?.title ?? "";
      inputEl?.blur();
    }
  }

  function handleFocus(): void {
    inputEl?.select();
  }
</script>

<div class="meeting-name">
  <input
    bind:this={inputEl}
    bind:value={draft}
    class="name-input"
    placeholder="meeting"
    aria-label="Meeting name"
    onkeydown={handleKeydown}
    onfocus={handleFocus}
    onblur={commit}
  />
</div>

<style>
  .meeting-name {
    margin: 0;
    padding: 8px 15px 0;
    background: var(--surface);
    font-family: var(--font-sans);
    font-size: 28px;
    font-weight: 700;
    color: var(--fg);
    line-height: 1.2;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .name-input {
    all: unset;
    width: 100%;
    cursor: text;
    /* Reserve the underline slot but hide it — see state rules below. */
    text-decoration: underline dashed transparent;
    text-underline-offset: 0.18em;
    text-decoration-thickness: 1px;
    transition: text-decoration-color 120ms ease;
  }
  /* Empty (placeholder showing): muted underline hints it's editable. */
  .name-input:placeholder-shown {
    text-decoration-color: var(--muted);
  }
  /* Hover always shows the accent underline, whether set or unset. */
  .name-input:hover:not(:focus) {
    text-decoration-color: var(--accent);
  }
  .name-input::placeholder {
    color: var(--muted);
    opacity: 1;
  }
</style>
