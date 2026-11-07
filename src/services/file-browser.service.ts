import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { ModDirectory, ModTextFileTarget, ModFileSearch } from '@/shared/types';
export function queryModDirectory(sessionId: string, directory: string | null): Promise<ModDirectory> {
  return invokeCommand('query_mod_directory', { payload: { sessionId, directory } });
}
export function queryModTextFileTarget(sessionId: string, relPath: string): Promise<ModTextFileTarget | null> {
  return invokeCommand('query_mod_text_file_target', { payload: { sessionId, relPath } });
}

export function queryModFileSearch(sessionId: string, query: string): Promise<ModFileSearch> {
  return invokeCommand('query_mod_file_search', { payload: { sessionId, query } });
}
