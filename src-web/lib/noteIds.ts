export function assignUniqueIds(
  current: (string | null)[],
  makeId: () => string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of current) {
    let id = raw;
    if (!id || seen.has(id)) id = makeId();
    seen.add(id);
    out.push(id);
  }
  return out;
}
