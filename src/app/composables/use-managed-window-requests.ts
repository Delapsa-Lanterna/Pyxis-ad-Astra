import { onScopeDispose } from 'vue';
import { subscribeWindowRequests } from '@/windows/window-context.window';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import type { ManagedWindowContext } from '@/shared/types';
export function useManagedWindowRequests(handler: (request: ManagedWindowContext) => Promise<void>) {
  onScopeDispose(subscribeWindowRequests(handler, recordWindowEventHandlerError));
}
