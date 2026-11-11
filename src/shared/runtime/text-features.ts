import { EditorState, type Text } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { java } from '@codemirror/lang-java';
import { codeFolding, foldGutter, foldKeymap, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { createTextSearchPanel, textFoldMarker, textFoldPlaceholder } from '@/shared/ui/text-editor-controls';
import { tags } from '@lezer/highlight';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';

export function textIndentation(text: Text): string {
  const widths: number[] = [];
  for (const line of text.sliceString(0, Math.min(text.length, 16384)).split('\n').slice(0, 200)) {
    const prefix = /^(\s+)\S/.exec(line)?.[1];
    if (!prefix || /^\s*\*/.test(line)) continue;
    if (prefix.includes('\t')) return '\t';
    widths.push(prefix.length);
  }
  const gcd = (left: number, right: number): number => (right ? gcd(right, left % right) : left);
  const width = widths.reduce(gcd, 0);
  return ' '.repeat(width || 4);
}
const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier], class: 'text-token-keyword' },
    { tag: [tags.string, tags.character], class: 'text-token-string' },
    { tag: [tags.number, tags.bool, tags.null], class: 'text-token-value' },
    { tag: tags.comment, class: 'text-token-comment' },
    { tag: [tags.typeName, tags.className], class: 'text-token-type' },
  ]),
);
export const isJavaText = (path: string | null | undefined) => /\.java$/i.test(path ?? '');
const longLines = new WeakMap<Text, boolean>();
export function hasLongTextLine(text: Text): boolean {
  if (text.length <= 20000) return false;
  const cached = longLines.get(text);
  if (cached !== undefined) return cached;
  // Immutable children share complete lines, so edits revisit only changed branches.
  const found = text.children ? text.children.some(hasLongTextLine) : [...text.iterLines()].some((line) => line.length > 20000);
  longLines.set(text, found);
  return found;
}
export function javaTextFeatures(path: string | null | undefined, text: Text) {
  return isJavaText(path) && !hasLongTextLine(text)
    ? [
        java(),
        highlighting,
        indentOnInput(),
        indentUnit.of(textIndentation(text)),
        codeFolding({ placeholderDOM: textFoldPlaceholder }),
        foldGutter({ markerDOM: textFoldMarker }),
        keymap.of([...foldKeymap, indentWithTab]),
      ]
    : [];
}
export const textSearchFeatures = [
  search({ top: true, createPanel: createTextSearchPanel }),
  keymap.of([...searchKeymap, { key: 'Mod-h', run: openSearchPanel, scope: 'editor search-panel' }]),
  EditorState.phrases.of({
    Find: '查找',
    Replace: '替换',
    next: '下一个',
    previous: '上一个',
    all: '选择全部',
    'match case': '区分大小写',
    regexp: '正则表达式',
    'by word': '全词匹配',
    replace: '替换当前',
    'replace all': '替换全部',
    close: '关闭查找',
    'Fold line': '折叠代码',
    'Unfold line': '展开代码',
    'folded code': '已折叠代码',
    unfold: '展开',
    'Folded lines': '已折叠行',
    'Unfolded lines': '已展开行',
    to: '至',
    'Go to line': '跳转到行',
    go: '跳转',
    'Invalid regexp': '正则表达式无效',
    'No matches found': '没有匹配结果',
  }),
];
