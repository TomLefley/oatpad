<script lang="ts">
  import * as store from "../lib/store.svelte";
  import EditableLabel from "./EditableLabel.svelte";

  type Size = "header" | "hero";
  type Props = { size?: Size };
  let { size = "header" }: Props = $props();

  const value = $derived(store.state.notetaker);
</script>

<h1 class="title" class:hero={size === "hero"}
  ><EditableLabel
    {value}
    placeholder="Your name"
    inputClass="name-input"
    dataCoachmarkTarget="notetaker"
    onCommit={(next) => store.setNotetaker(next)}
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
  :global(.title .name-input) {
    all: unset;
    min-width: 1ch;
    field-sizing: content;
    cursor: text;
    text-decoration: underline dashed transparent;
    text-underline-offset: 0.18em;
    text-decoration-thickness: 1px;
    transition: text-decoration-color 120ms ease;
  }
  :global(.title .name-input:placeholder-shown) {
    text-decoration-color: var(--muted);
  }
  :global(.title .name-input:hover:not(:focus)) {
    text-decoration-color: var(--accent);
  }
  :global(.title .name-input::placeholder) {
    color: var(--muted);
    opacity: 1;
  }
</style>
