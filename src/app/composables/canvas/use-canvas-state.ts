import { computed, shallowReadonly, ref, shallowRef } from 'vue';
import type { EditorTarget } from '@/domain/editors/editor-types';

export function createCanvasState<TPreview>() {
  const target = shallowRef<EditorTarget | null>(null);
  const hovered = shallowRef<EditorTarget | null>(null);
  const inspectorLock = shallowRef<EditorTarget | null>(null);
  const mirrorMode = ref(false);
  const preview = shallowRef<TPreview | null>(null);
  function select(next: EditorTarget | null, lock = false) {
    target.value = next;
    hovered.value = next;
    if (lock) inspectorLock.value = next;
  }
  function clear() {
    select(null);
  }
  function reset() {
    clear();
    inspectorLock.value = null;
    preview.value = null;
  }
  function leave() {
    hovered.value = null;
  }
  function selectPort(port: number | null) {
    target.value = target.value ? { ...target.value, port: port ?? undefined } : null;
  }
  return {
    target: shallowReadonly(target),
    hovered: shallowReadonly(hovered),
    inspectorLock: shallowReadonly(inspectorLock),
    mirrorMode: shallowReadonly(mirrorMode),
    preview: shallowReadonly(preview),
    selected: computed(() => target.value?.i ?? null),
    selectedPort: computed(() => target.value?.port ?? null),
    select,
    clear,
    reset,
    leave,
    selectPort,
    lock: (next: EditorTarget | null) => {
      inspectorLock.value = next;
    },
    setPreview: (next: TPreview | null) => {
      preview.value = next;
    },
    toggleMirror: () => {
      mirrorMode.value = !mirrorMode.value;
      preview.value = null;
    },
  };
}
export type CanvasState<T> = ReturnType<typeof createCanvasState<T>>;
