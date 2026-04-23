export type InlineRule = {
  re: RegExp;
  format: string;
};

export const INLINE_RULES: InlineRule[] = [
  { re: /\*\*([^*\n]+?)\*\*$/, format: "bold" },
  { re: /__([^_\n]+?)__$/, format: "bold" },
  { re: /(?<![*])\*([^*\n]+?)\*$/, format: "italic" },
  { re: /(?<![_])_([^_\n]+?)_$/, format: "italic" },
  { re: /~~([^~\n]+?)~~$/, format: "strike" },
  { re: /`([^`\n]+?)`$/, format: "code" },
];

export type InlineMatch = {
  startOffset: number;
  matchLength: number;
  content: string;
  format: string;
};

// Finds the first inline rule whose pattern ends at the right edge of `text`.
// `text` should be the document contents up to the caret.
export function matchInline(text: string): InlineMatch | null {
  for (const rule of INLINE_RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    const matchText = m[0];
    return {
      startOffset: text.length - matchText.length,
      matchLength: matchText.length,
      content: m[1],
      format: rule.format,
    };
  }
  return null;
}
