<script lang="ts">
  import * as store from "../lib/store.svelte";
  import { isNative, isWeb } from "../lib/platform";
  import IconButton from "./IconButton.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import MeetingMeta from "./MeetingMeta.svelte";
  import OatpadTitle from "./OatpadTitle.svelte";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Save from "@lucide/svelte/icons/save";
  import Search from "@lucide/svelte/icons/search";
  import Settings from "@lucide/svelte/icons/settings";
  import PanelLeftOpen from "@lucide/svelte/icons/panel-left-open";
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";

  type Props = {
    onnew: () => void;
    onopen: () => void;
    onsave: () => void;
    sidebarCollapsed?: boolean;
    sidebarWidth?: number;
    ontogglesidebar?: () => void;
    searchOpen?: boolean;
    ontogglesearch?: () => void;
    settingsOpen?: boolean;
    ontogglesettings?: () => void;
    // Notification dots. Each dot only appears when the bubble it
    // refers to is closed — once the bubble is open the user can see
    // the underlying state directly and the dot is just clutter.
    searchHasFilter?: boolean;
    updateReady?: boolean;
    // Schedule bubble lives at App level (so opening it can spacer the
    // editor). The Header just forwards the toggle through MeetingMeta's
    // trigger button.
    scheduleBubbleOpen?: boolean;
    ontogglescheduleBubble?: () => void;
  };
  let {
    onnew,
    onopen,
    onsave,
    sidebarCollapsed = false,
    sidebarWidth = 240,
    ontogglesidebar,
    searchOpen = false,
    ontogglesearch,
    settingsOpen = false,
    ontogglesettings,
    searchHasFilter = false,
    updateReady = false,
    scheduleBubbleOpen = false,
    ontogglescheduleBubble,
  }: Props = $props();
  const showSearchDot = $derived(searchHasFilter && !searchOpen);
  const showSettingsDot = $derived(updateReady && !settingsOpen);

  // Hide the title on the Getting Started view — it lives in the centred
  // hero there instead.
  const showTitle = $derived(store.state.meeting !== null);

  // Track collapse transitions so we can run a mirrored wobble animation
  // when the sidebar closes. (CSS animations only fire on class-add, not on
  // class-removal, so we add a transient `collapsing` flag for the duration
  // of the animation.)
  // Mirrors the CSS --anim-collapse token (which the .bouncing-out
  // animation is keyed off of) — kept in sync manually so the JS timer
  // outlasts the CSS animation.
  const COLLAPSE_HOLD_MS = 600;
  let prevExpanded: boolean | null = null;
  let collapsing = $state(false);
  let collapsingTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const expanded = !sidebarCollapsed;
    if (prevExpanded === null) {
      prevExpanded = expanded;
      return;
    }
    if (expanded !== prevExpanded) {
      if (!expanded) {
        collapsing = true;
        if (collapsingTimer) clearTimeout(collapsingTimer);
        // Hold the class for the full animation window: 420ms duration
        // plus the longest per-icon stagger (idx 3 × 45ms = 135ms) plus
        // a touch of slack so the trailing icon's tail oscillation is
        // included. Sourced from the --anim-collapse token.
        collapsingTimer = setTimeout(() => {
          collapsing = false;
        }, COLLAPSE_HOLD_MS);
      } else if (collapsingTimer) {
        clearTimeout(collapsingTimer);
        collapsingTimer = null;
        collapsing = false;
      }
      prevExpanded = expanded;
    }
  });
</script>

<header>
  {#if isNative}
    <div
      class="left-col"
      class:expanded={!sidebarCollapsed}
      style:--expanded-width="{sidebarWidth}px"
    >
      <div
        class="icon-tray"
        class:bouncing-in={!sidebarCollapsed}
        class:bouncing-out={collapsing}
      >
        <div class="expanded-icons">
          <button
            class="icon-btn wobble settings-slot"
            class:active={settingsOpen}
            onclick={ontogglesettings}
            aria-label="Settings"
            aria-expanded={settingsOpen}
            title={showSettingsDot ? "Settings — update ready" : "Settings"}
          >
            <Settings size={18} strokeWidth={2} />
            {#if showSettingsDot}
              <span class="dot" aria-hidden="true"></span>
            {/if}
          </button>
          <button
            class="icon-btn wobble search-slot"
            class:active={searchOpen}
            onclick={ontogglesearch}
            aria-label="Search meetings"
            aria-expanded={searchOpen}
            title={showSearchDot
              ? "Search meetings — filter active"
              : "Search meetings"}
          >
            <Search size={18} strokeWidth={2} />
            {#if showSearchDot}
              <span class="dot" aria-hidden="true"></span>
            {/if}
          </button>
          <button
            class="icon-btn wobble new-slot"
            onclick={onnew}
            aria-label="New meeting"
            title="New meeting"
          >
            <CalendarPlus size={18} strokeWidth={2} />
          </button>
        </div>
        <button
          class="icon-btn wobble toggle-slot"
          onclick={ontogglesidebar}
          aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
          title={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
        >
          <span class="toggle-icon" class:visible={sidebarCollapsed}>
            <PanelLeftOpen size={18} strokeWidth={2} />
          </span>
          <span class="toggle-icon" class:visible={!sidebarCollapsed}>
            <PanelLeftClose size={18} strokeWidth={2} />
          </span>
        </button>
      </div>
    </div>
    <MeetingMeta
      {scheduleBubbleOpen}
      onToggleScheduleBubble={ontogglescheduleBubble}
    />
    <div class="spacer" data-tauri-drag-region></div>
    {#if showTitle}
      <OatpadTitle size="header" />
    {/if}
  {:else}
    {#if showTitle}
      <OatpadTitle size="header" />
    {/if}
    <div class="spacer"></div>
    <div class="actions">
      <ThemeToggle />
      <IconButton onclick={onnew} label="New meeting">
        <CalendarPlus size={18} strokeWidth={2} />
      </IconButton>
      <IconButton onclick={onopen} label="Open file">
        <FolderOpen size={18} strokeWidth={2} />
      </IconButton>
      <IconButton onclick={onsave} label="Save file">
        <Save size={18} strokeWidth={2} />
      </IconButton>
    </div>
  {/if}
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--surface);
    min-height: 52px;
  }
  /* Web-mode lateral padding (native applies its own via left-col / title). */
  header :global(.title) {
    padding: 10px 16px 10px 0;
  }
  :global(html:not(.native)) header {
    padding: 0 16px;
  }
  :global(html:not(.native)) header :global(.title) {
    padding: 10px 0;
  }

  .left-col {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 10px var(--tray-padding-right) 10px var(--traffic-light-clearance);
    background: var(--surface);
    box-sizing: border-box;
    transition:
      width 180ms ease,
      background-color 180ms ease;
    /* Collapsed: room for the toggle icon + L/R paddings, plus the
       traffic-light clearance above. Computes to 136px with current
       atoms (32 + 12 + 92). */
    width: calc(
      var(--icon-size) + var(--tray-padding-right) + var(--traffic-light-clearance)
    );
    align-self: stretch;
    overflow: hidden;
  }
  .left-col.expanded {
    width: var(--expanded-width, 240px);
    background: var(--bg);
  }
  /* During resize drag, the width is being updated continuously via JS;
     suppress the transition so the header doesn't chase the sidebar. */
  :global(html.resizing) .left-col {
    transition: none;
  }
  .expanded-icons {
    display: flex;
    gap: var(--icon-gap);
    overflow: hidden;
    width: 0;
    margin: 0;
    opacity: 0;
    pointer-events: none;
    transition:
      width 180ms ease,
      margin 180ms ease,
      opacity 180ms ease;
  }
  /* Three icons (settings, search, new) plus two gaps. */
  .left-col.expanded .expanded-icons {
    width: calc(3 * var(--icon-size) + 2 * var(--icon-gap));
    margin-right: var(--expanded-icons-margin-right);
    opacity: 1;
    pointer-events: auto;
  }

  .spacer {
    flex: 1;
    align-self: stretch;
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  .icon-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    width: var(--icon-size);
    height: var(--icon-size);
    color: var(--icon);
  }
  .icon-btn:hover,
  .icon-btn.active {
    color: var(--icon-active);
  }
  /* Notification dot — pinned to the icon's top-right and tinted accent
     so it pops without competing with the glyph for the eye. The pop-in
     animation plays once on mount, which means it also plays when the
     dot remounts (e.g. on close-with-filter) — a quiet "look here". */
  .dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 1.5px var(--surface);
    pointer-events: none;
    animation: dot-pop var(--anim-dot) cubic-bezier(0.34, 1.5, 0.64, 1) backwards;
  }
  @keyframes dot-pop {
    0% {
      transform: scale(0);
      opacity: 0;
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }
  .icon-tray {
    display: flex;
    align-items: center;
  }
  /* Toggle button stacks both panel-left-open and panel-left-close on
     top of each other and cross-fades between them so the swap reads
     as a soft state change instead of a frame-perfect substitution.
     The slight scale/rotation gives the morph a hint of momentum
     without making the button feel busy. */
  .toggle-slot {
    position: relative;
  }
  .toggle-icon {
    position: absolute;
    inset: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: scale(0.78) rotate(-12deg);
    transition:
      opacity 180ms ease,
      transform 240ms cubic-bezier(0.34, 1.5, 0.64, 1);
    pointer-events: none;
  }
  .toggle-icon.visible {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
  /* --amp drives wobble distance; --idx drives the stagger. The toggle
     anchors the tray (always visible), so we treat it as idx 0 — its
     wobble starts first and the wave radiates outward through the
     icons that get revealed when the sidebar expands. Amplitudes
     decay sharply outward so the cascade reads as a rubber-band
     unfurling: the leading toggle bounces hardest, the trailing
     settings cog barely twitches. */
  .toggle-slot {
    --amp: 7px;
    --idx: 0;
  }
  .new-slot {
    --amp: 3px;
    --idx: 1;
  }
  .search-slot {
    --amp: 1.25px;
    --idx: 2;
  }
  .settings-slot {
    --amp: 0.4px;
    --idx: 3;
  }
  /* Peak at 43% (~180ms — exactly when the drawer's 180ms width transition
     settles), so the lateral motion is continuous through the handoff. After
     the peak, two damped oscillations carry the icons back to rest. Per-
     segment easing uses cubic-bezier(0.4, 0, 0.6, 1), a sine-like S-curve
     that feels more pendulum than spring.

     Each icon's animation starts at idx × 45ms, so the wave radiates
     outward from the toggle (idx 0) — the only icon visible while
     collapsed — through the icons revealed when the sidebar expands.
     Direction is driven by the `--dir` custom property: +1 for expand
     (overshoot right), -1 for collapse (overshoot left). */
  .icon-tray.bouncing-in .wobble,
  .icon-tray.bouncing-out .wobble {
    animation: trayWobble 420ms linear;
    animation-delay: calc(var(--idx, 0) * 45ms);
  }
  .icon-tray.bouncing-in .wobble {
    --dir: 1;
  }
  /* Collapse uses the same shape and timing as expand, but at 55%
     amplitude — a quieter handshake on the way out. */
  .icon-tray.bouncing-out .wobble {
    --dir: -0.55;
  }
  @keyframes trayWobble {
    0% {
      transform: translateX(0);
      animation-timing-function: ease-out;
    }
    43% {
      transform: translateX(calc(var(--amp, 8px) * var(--dir, 1)));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    66% {
      transform: translateX(calc(var(--amp, 8px) * var(--dir, 1) * -0.32));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    84% {
      transform: translateX(calc(var(--amp, 8px) * var(--dir, 1) * 0.2));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    100% {
      transform: translateX(0);
    }
  }
</style>
