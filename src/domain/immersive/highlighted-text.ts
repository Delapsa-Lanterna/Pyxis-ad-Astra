export function highlightedTextParts(text: string, highlights: string): Array<{ text: string; highlight: boolean }> {
  const terms = highlights
    .split('|')
    .map((term) => term.trim())
    .filter(Boolean);
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let start = 0;
  while (start < text.length) {
    const matches = terms
      .map((term) => ({ term, index: text.indexOf(term, start) }))
      .filter((match) => match.index >= 0)
      .sort((a, b) => a.index - b.index || b.term.length - a.term.length);
    const next = matches[0];
    if (!next) {
      parts.push({ text: text.slice(start), highlight: false });
      break;
    }
    if (next.index > start) parts.push({ text: text.slice(start, next.index), highlight: false });
    parts.push({ text: next.term, highlight: true });
    start = next.index + next.term.length;
  }
  return parts;
}
