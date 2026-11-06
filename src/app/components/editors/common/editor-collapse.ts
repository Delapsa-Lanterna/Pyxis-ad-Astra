import { nextTick, type InjectionKey, type Ref, type Slots } from 'vue';

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

export function scrollToNearest(scroll: HTMLElement, alignTop: number, alignBottom: number, left = scroll.scrollLeft) {
  scroll.scrollTo({
    left,
    top: Math.max(Math.min(alignTop, alignBottom), Math.min(scroll.scrollTop, Math.max(alignTop, alignBottom))),
    behavior: 'smooth',
  });
}

export async function scrollEditorTarget(root: HTMLElement, selectors: string[], accepts: () => boolean) {
  await nextTick();
  if (!accepts()) return;
  const scroll = root.querySelector<HTMLElement>('.editor-scroll')!;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (!accepts()) return;
  await waitForEditorCollapse(scroll);
  await nextTick();
  if (!accepts()) return;
  const target = selectors.map((selector) => scroll.querySelector<HTMLElement>(selector)).find(Boolean);
  if (target) {
    const bounds = target.getBoundingClientRect();
    const offset = scroll.scrollTop - scroll.getBoundingClientRect().top - scroll.clientTop;
    scrollToNearest(scroll, offset + bounds.top - 12, offset + bounds.bottom - scroll.clientHeight + 12);
  }
}

export function waitForEditorCollapse(root: Element) {
  return Promise.all([...leaving].filter(([element]) => root.contains(element)).map(([, transition]) => transition.finished));
}
