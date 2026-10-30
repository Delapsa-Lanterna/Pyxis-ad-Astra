import { requestWindow } from '@/windows/managed.window';
import type { FileWindowLocation } from '@/shared/types';

export interface FileEditorRequest {
  mode?: 'session' | 'recovery';
  modRoot: string | null;
  path: string;
  sessionId: string | null;
  title?: string;
  contextLabel?: string;
  contextSeverity?: FileWindowLocation['contextSeverity'];
  message?: string;
  line?: number;
  column?: number;
}

export type OpenFileEditorWindowRequest = FileEditorRequest;

export function openFileEditorWindow(request: OpenFileEditorWindowRequest) {
  return requestWindow({
    identity:
      request.mode === 'recovery'
        ? { type: 'recovery', modRoot: request.modRoot, path: request.path }
        : { type: 'file', sessionId: request.sessionId!, modRoot: request.modRoot!, path: request.path },
    title: request.title ?? '文件编辑器',
    input: {
      kind: 'file-editor',
      location: {
        contextLabel: request.contextLabel ?? null,
        contextSeverity: request.contextSeverity ?? null,
        message: request.message ?? null,
        line: request.line ?? null,
        column: request.column ?? null,
      },
    },
    size: {
      width: 1040,
      height: 760,
      minWidth: 780,
      minHeight: 520,
    },
  });
}
