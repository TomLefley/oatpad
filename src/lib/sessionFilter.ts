import type { SessionMeta } from "./sessions";
import { ymdLocal } from "./calendar";

export type SearchMode = "text" | "date";

export function labelFor(title: string): string {
  return title.trim() || "meeting";
}

// Sidebar filter logic. In date mode, an unset selection means "all
// sessions"; in text mode, an empty query likewise means "all sessions".
export function filterSessions(
  sessions: SessionMeta[],
  mode: SearchMode,
  query: string,
  selectedDate: string | null,
): SessionMeta[] {
  if (mode === "date") {
    if (!selectedDate) return sessions;
    return sessions.filter(
      (m) => ymdLocal(new Date(m.createdAt)) === selectedDate,
    );
  }
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((m) =>
    labelFor(m.title).toLowerCase().includes(q),
  );
}
