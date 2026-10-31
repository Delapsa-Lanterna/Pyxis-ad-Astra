import { computed, nextTick, onMounted, onUnmounted, shallowRef, ref, type Ref, type ShallowRef } from 'vue';
import type { EditorTarget, CanvasTarget, CanvasInput } from '@/domain/editors/editor-types';
import type { CanvasState } from './use-canvas-state';
import type { CanvasViewport } from './use-canvas-viewport';
import type { useEditorDocument } from '@/app/composables/editors/use-editor-document';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import { watchCanvasPixelRatio } from './use-canvas-surface';
import { useCanvasSelection } from './use-canvas-selection';
import { useCanvasNavigation } from './use-canvas-navigation';
import { waitForEditorCollapse } from '@/app/components/editors/common/editor-collapse';

export interface CanvasPick {
  byIdentity(identity: EditorTarget | null): CanvasTarget | null;
  byPointer(x: number, y: number): CanvasTarget | null;
}
export interface CanvasInspectorReveal {
  section: string;
  selector: string;
  lock: EditorTarget | null;
}
export interface CanvasGesture {
  kind: string;
  update(input: CanvasInput): void;
}
type PointerPhase =
  | { kind: 'idle' }
  | { kind: 'panning' }
  | { kind: 'waiting'; input: CanvasInput; latest: CanvasInput; ended: boolean }
  | { kind: 'gesture'; gesture: CanvasGesture };
export function useCanvasEditor<TPreview>(options: {
  document: ReturnType<typeof useEditorDocument>;
  stageRef: Readonly<ShallowRef<HTMLElement | null>>;
  windowRef: Readonly<ShallowRef<HTMLElement | null>>;
  expandedSections: Ref<(string | number)[]>;
  viewport: CanvasViewport;
  state: CanvasState<TPreview>;
  hooks: {
    targets(x: number, y: number): CanvasTarget[];
    radius(target: CanvasTarget): number;
    begin(input: CanvasInput, pick: CanvasPick): CanvasGesture | null;
    preview(input: CanvasInput): TPreview | null;
    previewTakesOver(input: CanvasInput): boolean;
    deleteSelected(): void;
    shortcuts: Record<string, () => void>;
    inspector(): CanvasInspectorReveal | null;
    draw(): void;
  };
}) {
  const { document, state, hooks, viewport, stageRef, windowRef, expandedSections } = options;
  const inputs = useFieldInputs();
  const feedback = useAppFeedback();
  const phase = shallowRef<PointerPhase>({ kind: 'idle' });
  const inside = ref(false);
  let revealRevision = 0;
  const navigation = useCanvasNavigation(viewport, hooks.draw, 'pointer');
  const selection = useCanvasSelection(state, hooks.targets, hooks.radius);
  const pointerInput = (event: MouseEvent): CanvasInput => ({
    point: { x: event.offsetX, y: event.offsetY },
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
  });
  const pick: CanvasPick = {
    byIdentity: (identity) => selection.byIdentity(identity, navigation.last.x, navigation.last.y),
    byPointer: selection.byPointer,
  };
  function idle() {
    phase.value = { kind: 'idle' };
    state.setPreview(null);
    navigation.finish();
  }
  function start(input: CanvasInput) {
    document.beginGesture(idle);
    const gesture = hooks.begin(input, pick);
    state.setPreview(null);
    if (gesture) {
      phase.value = { kind: 'gesture', gesture };
      gesture.update(input);
    } else document.finish(false);
    hooks.draw();
    return gesture;
  }
  function onDown(event: MouseEvent) {
    if (navigation.start(event)) {
      phase.value = { kind: 'panning' };
      return;
    }
    if (event.button !== 0) return;
    const input = pointerInput(event);
    const request: Extract<PointerPhase, { kind: 'waiting' }> = { kind: 'waiting', input, latest: input, ended: false };
    const pending = inputs?.commit();
    if (!pending) {
      start(input);
      return;
    }
    phase.value = request;
    void pending
      .then((accepted) => {
        if (!accepted || phase.value !== request) return;
        const gesture = start(request.input);
        gesture?.update(request.latest);
        if (request.ended) document.finish();
        hooks.draw();
      })
      .catch((error: unknown) => {
        idle();
        feedback.error(error);
      });
  }
  function onMove(event: MouseEvent) {
    const input = pointerInput(event);
    if (phase.value.kind === 'waiting') {
      phase.value.latest = input;
      return;
    }
    inside.value = true;
    if (navigation.move(event)) return;
    if (phase.value.kind === 'gesture') phase.value.gesture.update(input);
    else {
      state.setPreview(hooks.preview(input));
      if (!hooks.previewTakesOver(input) && !document.editingField.value) {
        const target = selection.nearest(input.point.x, input.point.y);
        if (target) selection.select(target);
        else selection.clear();
      }
    }
    hooks.draw();
  }
  function finishPointer() {
    if (phase.value.kind === 'waiting') phase.value.ended = true;
    else if (phase.value.kind === 'gesture') document.finish();
    if (phase.value.kind === 'panning') idle();
    else navigation.finish();
    state.setPreview(null);
  }
  function onUp() {
    finishPointer();
    hooks.draw();
  }
  function onLeave() {
    finishPointer();
    inside.value = false;
    state.leave();
    hooks.draw();
  }
  function modifiers(event: KeyboardEvent) {
    if (!['Shift', 'Control', 'Alt'].includes(event.key) || !inside.value || phase.value.kind !== 'idle' || navigation.panning.value)
      return;
    state.setPreview(
      hooks.preview({ point: { ...navigation.last }, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey }),
    );
    hooks.draw();
  }
  function resize() {
    const rect = stageRef.value?.getBoundingClientRect();
    if (viewport.resize(rect?.width, rect?.height)) hooks.draw();
  }
  function cancelInspectorReveal() {
    revealRevision++;
  }
  function revealInspector(select?: () => void) {
    const revision = ++revealRevision;
    const accepts = document.captureActionContext();
    return document.run(() => {
      if (revision !== revealRevision || !accepts()) return;
      select?.();
      const reveal = hooks.inspector();
      if (!reveal) return;
      if (reveal.lock) state.select(reveal.lock, true);
      expandedSections.value = [reveal.section];
      void scrollInspector(reveal, () => revision === revealRevision && accepts()).catch((error: unknown) => feedback.error(error));
    });
  }
  async function scrollInspector(reveal: CanvasInspectorReveal, accepts: () => boolean) {
    await nextTick();
    if (!accepts()) return;
    const scroll = windowRef.value?.querySelector<HTMLElement>('.editor-scroll');
    if (!scroll) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!accepts()) return;
    await waitForEditorCollapse(scroll);
    await nextTick();
    if (!accepts()) return;
    const target = scroll.querySelector<HTMLElement>(reveal.selector);
    if (target) {
      const bounds = target.getBoundingClientRect();
      const viewportTop = scroll.getBoundingClientRect().top + scroll.clientTop;
      const alignTop = scroll.scrollTop + bounds.top - viewportTop - 12;
      const alignBottom = scroll.scrollTop + bounds.bottom - viewportTop - scroll.clientHeight + 12;
      scroll.scrollTo({
        top: Math.max(Math.min(alignTop, alignBottom), Math.min(scroll.scrollTop, Math.max(alignTop, alignBottom))),
        behavior: 'smooth',
      });
    }
  }
  function reset() {
    cancelInspectorReveal();
    idle();
    state.reset();
  }

  useWindowShortcuts({
    commands: { undo: () => void document.undo(), redo: () => void document.redo() },
    keys: {
      ' ': () =>
        void document.run(() => {
          state.toggleMirror();
          hooks.draw();
        }),
      backspace: hooks.deleteSelected,
      t: () => void revealInspector(),
      ...hooks.shortcuts,
    },
  });
  let stopDpi: () => void;
  onMounted(() => {
    stopDpi = watchCanvasPixelRatio(resize);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', modifiers);
    window.addEventListener('keyup', modifiers);
    void nextTick(() => {
      windowRef.value?.focus({ preventScroll: true });
      resize();
    });
  });
  onUnmounted(() => {
    reset();
    stopDpi?.();
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', modifiers);
    window.removeEventListener('keyup', modifiers);
  });
  return {
    onDown,
    onMove,
    onUp,
    onLeave,
    onWheel: navigation.wheel,
    onExpandedSectionsUpdate: () => {
      cancelInspectorReveal();
      state.lock(null);
    },
    revealInspector,
    cancelInspectorReveal,
    reset,
    pointerState: (): Readonly<{ inside: boolean; x: number; y: number }> => ({ inside: inside.value, ...navigation.last }),
    dragKind: computed(() => (phase.value.kind === 'gesture' ? phase.value.gesture.kind : null)),
  };
}
