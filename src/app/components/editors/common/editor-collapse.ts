import type { InjectionKey, Ref, Slots } from 'vue';

export const editorCollapseKey: InjectionKey<{
  expanded: Readonly<Ref<(string | number)[]>>;
  toggle: (name: string | number) => void;
  slots: Slots;
}> = Symbol('editor-collapse');

const leaving = new Map<Element, { finished: Promise<void>; resolve: () => void }>();

export function beginEditorCollapseLeave(element: Element) {
  let resolve!: () => void;
  const finished = new Promise<void>((done) => {
    resolve = done;
  });
  leaving.set(element, { finished, resolve });
}

export function finishEditorCollapseLeave(element: Element) {
  leaving.get(element)?.resolve();
  leaving.delete(element);
}

export function waitForEditorCollapse(root: Element) {
  return Promise.all([...leaving].filter(([element]) => root.contains(element)).map(([, transition]) => transition.finished));
}
