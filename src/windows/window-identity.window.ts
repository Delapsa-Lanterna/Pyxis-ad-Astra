import type { FeedbackFileSession } from '@/shared/lib/feedback-session';
import { managedWindowContext } from './window-context.window';
export function currentWindowSessionIdentity(): FeedbackFileSession | null {
  const identity = managedWindowContext.value?.identity;
  return identity && 'sessionId' in identity ? { modRoot: identity.modRoot, sessionId: identity.sessionId } : null;
}
