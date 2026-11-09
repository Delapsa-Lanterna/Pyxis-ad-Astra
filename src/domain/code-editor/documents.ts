import { pathBasename } from '@/shared/lib/paths';

export interface TextViewState {
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
  top: number;
  left: number;
}
export const emptyTextView = (): TextViewState => ({ start: 0, end: 0, direction: 'none', top: 0, left: 0 });
export function textOffset(text: string, line: number, column = 1) {
  const normalized = text.replace(/\r\n|\r/g, '\n');
  let offset = 0;
  for (let index = 1; index < line; index++) {
    const next = normalized.indexOf('\n', offset);
    if (next < 0) return normalized.length;
    offset = next + 1;
  }
  const end = normalized.indexOf('\n', offset);
  return Math.min(end < 0 ? normalized.length : end, offset + Math.max(0, column - 1));
}
// Native textareas expose LF; map only the edited range back to the original line endings.
export function applyTextInput(original: string, next: string, selection?: { start: number; end: number; caret: number }): string {
  if (!original.includes('\r')) return next;
  const before = original.replace(/\r\n|\r/g, '\n');
  let start = 0,
    end = before.length,
    nextEnd = next.length;
  if (selection && (selection.start !== 0 || selection.end !== before.length)) {
    start = Math.min(selection.start, selection.caret);
    end = Math.max(selection.end, selection.caret + before.length - next.length);
    nextEnd = end + next.length - before.length;
  } else {
    while (start < end && start < nextEnd && before[start] === next[start]) start++;
    while (end > start && nextEnd > start && before[end - 1] === next[nextEnd - 1]) {
      end--;
      nextEnd--;
    }
  }
  function originalOffset(position: number) {
    let extra = 0;
    for (const match of original.matchAll(/\r\n/g)) {
      if (match.index - extra >= position) break;
      extra++;
    }
    return position + extra;
  }
  const newline = /\r\n|\r|\n/.exec(original)?.[0] ?? '\n';
  return (
    original.slice(0, originalOffset(start)) + next.slice(start, nextEnd).replace(/\n/g, newline) + original.slice(originalOffset(end))
  );
}
export function tabLabel(path: string, paths: string[], root: string): string {
  const name = pathBasename(path);
  if (paths.filter((other) => pathBasename(other) === name).length < 2) return name;
  return path.slice(root.length).replace(/^[\\/]/, '');
}
