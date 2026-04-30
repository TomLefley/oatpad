<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    onclick: () => void;
    label: string;
    title?: string;
    active?: boolean;
    ariaExpanded?: boolean;
    children?: Snippet;
  };
  let {
    onclick,
    label,
    title,
    active = false,
    ariaExpanded,
    children,
  }: Props = $props();
</script>

<button
  class="icon-btn"
  class:active
  {onclick}
  aria-label={label}
  aria-expanded={ariaExpanded}
  title={title ?? label}
>
  {@render children?.()}
</button>

<style>
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    width: 32px;
    height: 32px;
    color: var(--icon);
  }
  .icon-btn:hover,
  .icon-btn.active {
    color: var(--icon-active);
  }
</style>
