<script lang="ts">
  type Props = {
    // External value to mirror. Updates from the store flow in here;
    // local edits flow out via onCommit (not via $bindable, because the
    // canonical store is what determines authoritative state).
    value: string;
    placeholder?: string;
    ariaLabel?: string;
    onCommit: (next: string) => void;
    inputClass?: string;
    // Optional hook for callers that need to target the input element
    // (the OatpadTitle coachmark uses this).
    dataCoachmarkTarget?: string;
  };
  let {
    value,
    placeholder,
    ariaLabel,
    onCommit,
    inputClass = "",
    dataCoachmarkTarget,
  }: Props = $props();

  // Seed draft from the initial prop. The $effect below pulls in
  // subsequent external changes when the user isn't focused.
  // svelte-ignore state_referenced_locally
  let draft = $state(value);
  let inputEl: HTMLInputElement | undefined = $state();

  // Sync draft to external value when the user isn't actively editing —
  // covers store-driven changes (autosave-loaded titles, store reset, etc.)
  // without clobbering an in-progress edit.
  $effect(() => {
    if (value !== draft && document.activeElement !== inputEl) {
      draft = value;
    }
  });

  function commit(): void {
    const trimmed = draft.trim();
    draft = trimmed;
    onCommit(trimmed);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      inputEl?.blur();
    } else if (e.key === "Escape") {
      draft = value;
      inputEl?.blur();
    }
  }

  function handleFocus(): void {
    inputEl?.select();
  }
</script>

<input
  bind:this={inputEl}
  bind:value={draft}
  class={inputClass}
  {placeholder}
  aria-label={ariaLabel}
  data-coachmark-target={dataCoachmarkTarget}
  onkeydown={handleKeydown}
  onfocus={handleFocus}
  onblur={commit}
/>
