// Pure string-affix helpers used by noteFlush's diff computation.
// Pulled out of noteFlush.ts so the test file can import them as a
// first-class API rather than reaching across an @internal-by-comment
// boundary.

export function commonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

export function commonSuffixLen(
  a: string,
  b: string,
  fromPrefix: number,
): number {
  const maxA = a.length - fromPrefix;
  const maxB = b.length - fromPrefix;
  const max = Math.min(maxA, maxB);
  let i = 0;
  while (
    i < max &&
    a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
  ) {
    i++;
  }
  return i;
}
