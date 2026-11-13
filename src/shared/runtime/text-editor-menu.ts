import type { EditorView } from '@codemirror/view';

const editors = new WeakMap<HTMLElement, () => TextEditorMenu>();
export interface TextEditorMenu {
  root: HTMLElement;
  readOnly: boolean;
  selection: string;
  current: () => boolean;
  selectAll: () => void;
  replace: (text: string, all: boolean, paste: boolean) => void;
}
export function registerTextEditorMenu(view: EditorView) {
  const root = view.contentDOM;
  editors.set(root, () => {
    const selection = root.ownerDocument.getSelection();
    // Native right-click selection can precede the editor's selection-change delivery.
    if (selection?.anchorNode && selection.focusNode && root.contains(selection.anchorNode) && root.contains(selection.focusNode)) {
      const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset),
        head = view.posAtDOM(selection.focusNode, selection.focusOffset);
      if (anchor !== view.state.selection.main.anchor || head !== view.state.selection.main.head)
        view.dispatch({ selection: { anchor, head } });
    }
    const state = view.state;
    return {
      root,
      readOnly: state.readOnly,
      selection: state.selection.ranges
        .filter(({ empty }) => !empty)
        .map(({ from, to }) => state.sliceDoc(from, to))
        .join('\n'),
      current: () =>
        editors.has(root) &&
        root.isConnected &&
        view.state.readOnly === state.readOnly &&
        view.state.doc === state.doc &&
        view.state.selection.eq(state.selection),
      selectAll() {
        view.dispatch({ selection: { anchor: 0, head: state.doc.length } });
        view.focus();
      },
      replace(text, all, paste) {
        view.dispatch({
          ...(all ? { changes: { from: 0, to: state.doc.length } } : state.replaceSelection(text)),
          userEvent: paste ? 'input.paste' : 'delete.cut',
          scrollIntoView: true,
        });
        view.focus();
      },
    };
  });
  return () => {
    editors.delete(root);
  };
}
export function captureTextEditorMenu(target: HTMLElement): TextEditorMenu | undefined {
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    const capture = editors.get(element);
    if (capture) return capture();
  }
  return undefined;
}
