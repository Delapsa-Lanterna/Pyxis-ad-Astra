import { inject, provide, ref, onUnmounted, type InjectionKey, type Ref } from 'vue';
import type { CloseScope, CloseResult } from '@/shared/types';

export interface WindowCloseParticipantOptions {
  settle?: () => Promise<void>;
  dirty: Readonly<Ref<boolean>>;
  dirtyForScope?: (scope: CloseScope) => boolean;
  title: string;
  content: string;
}
interface WindowCloseParticipant {
  install: () => Promise<void>;
  requestClose: () => Promise<boolean>;
  dispose: () => void;
}
interface WindowCloseActions {
  requestClose: (scope: CloseScope) => Promise<CloseResult>;
  createParticipant: (options: WindowCloseParticipantOptions) => WindowCloseParticipant;
}
const closeActionsKey: InjectionKey<WindowCloseActions> = Symbol('window-close-actions');
const closeStateKey: InjectionKey<Ref<boolean>> = Symbol('window-close-state');

export function provideWindowCloseState(actions: WindowCloseActions) {
  provide(closeActionsKey, actions);
  const closing = ref(false);
  provide(closeStateKey, closing);
  return closing;
}
export function useWindowCloseState() {
  return inject(closeStateKey, null);
}
export function useWindowCloseRequest() {
  return inject(closeActionsKey)!.requestClose;
}
export function useWindowCloseParticipant(options: WindowCloseParticipantOptions) {
  const participant = inject(closeActionsKey)!.createParticipant(options);
  onUnmounted(participant.dispose);
  return { install: participant.install, requestClose: participant.requestClose };
}
