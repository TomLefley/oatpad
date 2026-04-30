<script lang="ts">
  import * as store from "../lib/store.svelte";
  import { monthStart } from "../lib/calendar";
  import { type SearchMode, filterMeetings } from "../lib/meetingFilter";
  import { slide } from "svelte/transition";
  import MeetingList from "./MeetingList.svelte";
  import SearchBubble from "./SearchBubble.svelte";
  import SettingsBubble from "./SettingsBubble.svelte";

  type Props = {
    collapsed: boolean;
    width: number;
    onswitch: (id: string) => void;
    ondelete: (id: string) => void | Promise<void>;
    searchOpen?: boolean;
    oncloseSearch?: () => void;
    settingsOpen?: boolean;
    oncloseSettings?: () => void;
    // Bindable; true whenever a non-default search filter is in effect
    // (text query OR a picked date). The header reads this to draw the
    // notification dot on the search icon when the bubble is closed.
    searchActive?: boolean;
  };
  let {
    collapsed,
    width,
    onswitch,
    ondelete,
    searchOpen = false,
    oncloseSearch,
    settingsOpen = false,
    oncloseSettings,
    searchActive = $bindable(false),
  }: Props = $props();

  // Search filter state lives here so it survives the bubble's mount/unmount
  // cycle (the bubble's body lives behind {#if searchOpen} so it can outro)
  // — and so it survives a full close/reopen cycle. The bubble is a control
  // surface; the filter it represents is part of the sidebar's state.
  let searchMode = $state<SearchMode>("text");
  let searchQuery = $state("");
  let selectedDate = $state<string | null>(null);
  let viewMonth = $state(monthStart(new Date()));
  const filteredMeetings = $derived(
    filterMeetings(store.state.meetings, searchMode, searchQuery, selectedDate),
  );
  $effect(() => {
    searchActive = searchQuery !== "" || selectedDate !== null;
  });

  // Both bubbles measure their content height; the spacer above the list is
  // the larger of the two so the meeting list slides clear regardless of
  // which bubble is open. SPACER_OVERHEAD covers the bubble's vertical
  // padding (8 + 6) plus body padding (6 + 8) plus 4px breathing.
  const SPACER_OVERHEAD = 24;
  let searchContentHeight = $state(22);
  let settingsContentHeight = $state(96);
  const searchSpacer = $derived(
    searchOpen ? Math.max(42, searchContentHeight + SPACER_OVERHEAD) : 0,
  );
  const settingsSpacer = $derived(
    settingsOpen ? Math.max(48, settingsContentHeight + SPACER_OVERHEAD) : 0,
  );

  // Cross-bubble choreography: when *either* bubble closes, the meeting
  // list rides a staggered concertina-settle animation. This effect lives
  // in the shell because it's the only place that sees both bubbles'
  // open/close edges at once.
  let listWobbling = $state(false);
  // INVARIANT: prevSearchOpen/prevSettingsOpen are intentionally NOT $state.
  // They mirror the previous run's prop values so the effect can detect a
  // close transition (was-open → now-closed). Promoting them to $state
  // would make the effect track its own writes and re-fire spuriously.
  // The effect is guaranteed to run when searchOpen/settingsOpen flip
  // (those are reactive props), which is the only time we need to update
  // them — closure-captured plain `let` is the right shape here.
  let prevSearchOpen = false;
  let prevSettingsOpen = false;
  let listWobbleTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const justClosed =
      (prevSearchOpen && !searchOpen) ||
      (prevSettingsOpen && !settingsOpen);
    prevSearchOpen = searchOpen;
    prevSettingsOpen = settingsOpen;
    if (!justClosed) return;
    listWobbling = false;
    // Force a reflow so re-adding the class the next tick actually
    // re-triggers the animation when bubbles open/close in quick
    // succession.
    requestAnimationFrame(() => {
      listWobbling = true;
      if (listWobbleTimer) clearTimeout(listWobbleTimer);
      listWobbleTimer = setTimeout(() => {
        listWobbling = false;
      }, 700);
    });
  });

  // Sidebar-level Escape handling. The trash button on a row can't catch
  // a keyup once focus has drifted, so the listener lives at <aside>
  // level and reaches into MeetingList via bind:this. Returning a boolean
  // from clearConfirm() lets us preventDefault only when we actually
  // consumed the keystroke — the bubbles handle their own Escape inside
  // their own keydown handlers, which fire from focus inside.
  let meetingList: MeetingList | undefined = $state();
  function handleSidebarKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && meetingList?.clearConfirm()) {
      e.preventDefault();
    }
  }
</script>

{#if !collapsed}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside
    class="sidebar"
    style:width="{width}px"
    transition:slide={{ axis: "x", duration: 180 }}
    onkeydown={handleSidebarKeydown}
  >
    <!-- Spacer holds the layout space below whichever bubble is open. Its
         height is the larger of the two bubbles' desired heights so the
         list slides clear of the open bubble. Same source value, same
         easing as the bubbles' content-stack transition. -->
    <div
      class="search-spacer"
      style:height="{Math.max(searchSpacer, settingsSpacer)}px"
    ></div>
    {#if settingsOpen}
      <SettingsBubble
        onclose={() => oncloseSettings?.()}
        bind:contentHeight={settingsContentHeight}
      />
    {/if}
    {#if searchOpen}
      <SearchBubble
        onclose={() => oncloseSearch?.()}
        bind:searchMode
        bind:searchQuery
        bind:selectedDate
        bind:viewMonth
        bind:contentHeight={searchContentHeight}
      />
    {/if}
    <MeetingList
      bind:this={meetingList}
      meetings={filteredMeetings}
      wobbling={listWobbling}
      {onswitch}
      {ondelete}
    />
  </aside>
{/if}

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    overflow: hidden;
    flex-shrink: 0;
  }
  /* Height is set inline from the larger of the two bubbles' desired
     spacer heights, and 0 when neither is open. The CSS transition smooths
     every change with the same overshoot bezier the bubble's pop-in uses,
     so opening, closing, and mode switching all share the same little
     springy feel. */
  .search-spacer {
    flex-shrink: 0;
    transition: height 140ms cubic-bezier(0.34, 1.25, 0.64, 1);
  }
</style>
