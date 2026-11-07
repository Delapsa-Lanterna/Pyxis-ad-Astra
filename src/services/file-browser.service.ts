import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { FileDirectory, FileTextTarget, FileSearch } from '@/shared/types';
export function queryFileDirectory(sessionId: string, directory: string | null): Promise<FileDirectory> {
  return invokeCommand('query_file_directory', { payload: { sessionId, directory } });
}
export function queryFileTextTarget(sessionId: string, relPath: string): Promise<FileTextTarget | null> {
  return invokeCommand('query_file_text_target', { payload: { sessionId, relPath } });
}

export function queryFileSearch(sessionId: string, query: string): Promise<FileSearch> {
  return invokeCommand('query_file_search', { payload: { sessionId, query } });
}
