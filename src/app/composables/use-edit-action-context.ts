import { onScopeDispose, watch, type Ref } from 'vue';
import type { EditContext } from '@/shared/types';

export function useEditActionContext(context: Readonly<Ref<EditContext | null>>) {
  let generation = 0;
  watch(
    context,
    (next) => {
      if (!next || (next.handoff !== 'save' && next.handoff !== 'identity')) generation++;
    },
    { flush: 'sync' },
  );
  onScopeDispose(() => {
    generation++;
  });
  function captureActionContext() {
    const captured = generation;
    return () => captured === generation;
  }
  return { captureActionContext };
}
