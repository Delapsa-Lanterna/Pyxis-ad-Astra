import { inject, provide, ref, type InjectionKey, type Ref } from 'vue';

import type { CloseScope, CloseResult, ClosePhase, ErrorDiagnostic } from '@/shared/types';

interface WindowLifecycleActions {
  replyClose: (operationId: number, phase: ClosePhase, accepted: boolean, diagnostic: ErrorDiagnostic | null) => Promise<void>;
  readyClose: () => Promise<void>;
  requestClose: (scope: CloseScope) => Promise<CloseResult>;
  prepareDisplay: () => () => Promise<void>;
  acceptReleasedSessions: (sessionIds: string[]) => void;
  flushSettings: () => Promise<void>;
}
const lifecycleKey: InjectionKey<WindowLifecycleActions> = Symbol('window-lifecycle-actions');

export const useWindowLifecycleActions = () => inject(lifecycleKey)!;

const closeStateKey: InjectionKey<Ref<boolean>> = Symbol('window-close-state');

export function provideWindowCloseState(actions: WindowLifecycleActions) {
  provide(lifecycleKey, actions);
  const closing = ref(false);
  provide(closeStateKey, closing);
  return closing;
}

export function useWindowCloseState() {
  return inject(closeStateKey, null);
}
