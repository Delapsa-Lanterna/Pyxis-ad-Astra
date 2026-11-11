import { afterEach, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { getSearchQuery, openSearchPanel, setSearchQuery, SearchQuery } from '@codemirror/search';
import { textSearchFeatures } from '@/shared/runtime/text-features';
import { textFoldMarker, textFoldPlaceholder } from './text-editor-controls';

let view: EditorView;
afterEach(() => {
  view.destroy();
});
function open(readOnly = false) {
  view = new EditorView({
    state: EditorState.create({ doc: 'value value', extensions: [history(), textSearchFeatures, EditorState.readOnly.of(readOnly)] }),
  });
  openSearchPanel(view);
  return view.dom;
}
it('uses SVG folding controls and calls the supplied unfold action', () => {
  open();
  const marker = textFoldMarker(true);
  expect(marker.textContent).toBe('');
  expect(marker.querySelector('svg')).not.toBeNull();
  let unfolded = 0;
  const placeholder = textFoldPlaceholder(view, () => {
    unfolded++;
  });
  placeholder.click();
  expect(unfolded).toBe(1);
  expect(placeholder.getAttribute('aria-label')).toBe('已折叠代码');
});
it('synchronizes search, replaces through native history and closes through the SVG button', () => {
  const dom = open(),
    find = dom.querySelector<HTMLInputElement>('[name="search"]')!,
    replace = dom.querySelector<HTMLInputElement>('[name="replace"]')!;
  find.value = 'value';
  find.dispatchEvent(new Event('input'));
  replace.value = 'count';
  replace.dispatchEvent(new Event('input'));
  dom.querySelector<HTMLButtonElement>('[name="replaceAll"]')!.click();
  expect(view.state.doc.toString()).toBe('count count');
  undo(view);
  expect(view.state.doc.toString()).toBe('value value');
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '[', regexp: true })) });
  expect(find.getAttribute('aria-invalid')).toBe('true');
  expect(getSearchQuery(view.state).regexp).toBe(true);
  const close = dom.querySelector<HTMLButtonElement>('[name="close"]')!;
  expect(close.textContent).toBe('');
  expect(close.querySelector('svg')).not.toBeNull();
  close.click();
  expect(dom.querySelector('.cm-search')).toBeNull();
});
it('preserves a read-only search surface without replace controls', () => {
  const dom = open(true);
  expect(dom.querySelector('[name="search"]')!.getAttribute('aria-invalid')).toBe('false');
  expect(dom.querySelector<HTMLInputElement>('[name="search"]')).not.toBeNull();
  expect(dom.querySelector('[name="replace"]')!.parentElement!.hidden).toBe(true);
  expect(view.state.doc.toString()).toBe('value value');
});
