import { inject, provide, type InjectionKey } from 'vue';
import type { AppFeedback } from '@/shared/types';

const feedbackKey: InjectionKey<AppFeedback> = Symbol('app-feedback');
export function provideAppFeedback(feedback: AppFeedback) {
  provide(feedbackKey, feedback);
}
export function useAppFeedback(): AppFeedback {
  return inject(feedbackKey)!;
}
