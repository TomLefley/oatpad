<script lang="ts">
  import * as store from "../lib/store.svelte";
  import EditableLabel from "./EditableLabel.svelte";

  const value = $derived(store.state.meeting?.title ?? "");
</script>

<div class="meeting-name">
  <EditableLabel
    {value}
    placeholder="meeting"
    ariaLabel="Meeting name"
    inputClass="name-input"
    onCommit={(next) => store.setTitle(next)}
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
  :global(.meeting-name .name-input) {
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
  :global(.meeting-name .name-input:placeholder-shown) {
    text-decoration-color: var(--muted);
  }
  /* Hover always shows the accent underline, whether set or unset. */
  :global(.meeting-name .name-input:hover:not(:focus)) {
    text-decoration-color: var(--accent);
  }
  :global(.meeting-name .name-input::placeholder) {
    color: var(--muted);
    opacity: 1;
  }
</style>
