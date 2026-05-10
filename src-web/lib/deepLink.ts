import { isNative } from "./platform";

// Custom URL scheme registered in tauri.conf.json (`plugins.deep-link.desktop.schemes`).
// Canonical form: `oats://meeting/<meetingId>`. The MCP server hands the
// same shape back so an agent can paste a clickable link into chat.
const SCHEME = "oats:";

export function buildMeetingLink(meetingId: string): string {
  return `oats://meeting/${meetingId}`;
}

export type ParsedOatsUrl = { kind: "meeting"; meetingId: string };

export function parseOatsUrl(url: string): ParsedOatsUrl | null {
  if (!url.startsWith(SCHEME)) return null;
  const rest = url.slice(SCHEME.length).replace(/^\/\//, "");
  const m = rest.match(/^meeting\/([A-Za-z0-9_-]+)\/?$/);
  if (!m) return null;
  return { kind: "meeting", meetingId: m[1] };
}

export type DeepLinkHandlers = {
  onMeeting: (meetingId: string) => void | Promise<void>;
};

// Subscribes to deep-link events fired by the Tauri plugin and replays
// any URL the app was launched with. Returns an unsubscribe function.
// No-ops on web — the plugin lives in tauri-plugin-deep-link, which
// is only available inside the .app.
export async function initDeepLinks(
  handlers: DeepLinkHandlers,
): Promise<() => void> {
  if (!isNative) return () => {};
  const { onOpenUrl, getCurrent } = await import(
    "@tauri-apps/plugin-deep-link"
  );

  const dispatch = (urls: string[] | null | undefined): void => {
    if (!urls) return;
    for (const url of urls) {
      const parsed = parseOatsUrl(url);
      if (!parsed) continue;
      if (parsed.kind === "meeting") void handlers.onMeeting(parsed.meetingId);
    }
  };

  // The URL the app was launched with (cold-start case). `getCurrent`
  // returns the same list `onOpenUrl` would have fired had the app
  // already been running — so handle it once on boot.
  try {
    const current = await getCurrent();
    dispatch(current);
  } catch {
    // getCurrent throws on platforms without deep-link support; the
    // listener call below also throws if the plugin isn't available,
    // so swallow here and let that failure surface instead.
  }

  const unlisten = await onOpenUrl(dispatch);
  return unlisten;
}
