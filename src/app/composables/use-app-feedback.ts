import { inject, provide, type InjectionKey } from 'vue';
import type { WindowFeedback, FeedbackContext } from '@/shared/types';

const feedbackKey: InjectionKey<WindowFeedback> = Symbol('app-feedback');
export function provideAppFeedback(feedback: WindowFeedback) {
  provide(feedbackKey, feedback);
}
export function useAppFeedback(getContext?: () => FeedbackContext): WindowFeedback {
  const feedback = inject(feedbackKey)!;
  if (!getContext) return feedback;
  const source = (context?: FeedbackContext) => ({ paths: [...getContext().paths, ...(context?.paths ?? [])] });
  const scoped: WindowFeedback = {
    ...feedback,
    success: (text, context) => feedback.success(text, source(context)),
    info: (text, context) => feedback.info(text, source(context)),
    warning: (notice, context) => feedback.warning(notice, source(context)),
    error: (error, text, context) => feedback.error(error, text, source(context)),
  };
  provideAppFeedback(scoped);
  return scoped;
}
