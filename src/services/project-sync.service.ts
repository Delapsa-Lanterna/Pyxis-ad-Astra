import type { InvalidateProjectSessionPayload, SourceRefresh, FileChangeRecord, ProjectSessionInvalidationResult } from '@/shared/types';
import { commandChannel, invokeCommand, invokeSaveCommand } from '@/shared/runtime/command.runtime';
import type { SaveDelivery } from '@/shared/types';

export function registerSaveWindow(receive: (delivery: SaveDelivery) => void) {
  let received!: () => void;
  const snapshot = new Promise<void>((resolve) => {
    received = resolve;
  });
  return invokeCommand<void>('register_save_window', {
    channel: commandChannel((delivery: SaveDelivery) => {
      receive(delivery);
      if (delivery.kind === 'references') received();
    }),
  }).then(() => snapshot);
}

export function setReferenceSources(sessionIds: string[], order: string[] = sessionIds) {
  return invokeCommand<void>('set_reference_sources', { sessionIds, order });
}

export function abandonProjectSaves(modRoots: string[]) {
  return invokeCommand<void>('abandon_project_saves', { modRoots });
}

export function resolveSaveSources(requestId: string, paths: string[], accepted: boolean) {
  return invokeCommand<void>('resolve_save_sources', { requestId, paths, accepted });
}

export function unregisterSaveWindow() {
  return invokeCommand<void>('unregister_save_window');
}

export function retryProjectSave(requestId: string) {
  return invokeCommand<void>('retry_project_save', { requestId });
}

export function waitProjectSaves(modRoots: string[]) {
  return invokeCommand<void>('wait_project_saves', { modRoots });
}

export function requestProjectSessionRefresh(sessionId: string, changes: FileChangeRecord[]): Promise<ProjectSessionInvalidationResult> {
  return invokeCommand('invalidate_project_session', { payload: { sessionId, changes } satisfies InvalidateProjectSessionPayload });
}

export function refreshProjectSources(
  sessionId: string,
  sources: readonly import('@/shared/types').InvalidatedResourceScope[],
): Promise<import('@/shared/types').WriteResult<unknown>> {
  return invokeSaveCommand('refresh_project_sources', { payload: { sessionId, sources } satisfies SourceRefresh });
}
