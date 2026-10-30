import { inject, provide, type InjectionKey } from 'vue';
import type { WindowFeedback } from '@/shared/types';

const feedbackKey: InjectionKey<WindowFeedback> = Symbol('app-feedback');
export function provideAppFeedback(feedback: WindowFeedback) {
  provide(feedbackKey, feedback);
}
export function useAppFeedback(): WindowFeedback {
  return inject(feedbackKey)!;
}
