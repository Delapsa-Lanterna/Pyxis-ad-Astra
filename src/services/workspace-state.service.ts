import type { SaveWorkspacePayload, PersistedWorkspace } from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';

export function loadPersistedWorkspace(): Promise<PersistedWorkspace> {
  return invokeCommand('load_workspace');
}

export function savePersistedWorkspace(state: PersistedWorkspace): Promise<void> {
  return invokeCommand('save_workspace', { payload: { state } satisfies SaveWorkspacePayload });
}
