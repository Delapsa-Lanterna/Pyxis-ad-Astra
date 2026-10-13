import { openManagedWindow } from '@/windows/managed.window';
import type { FileWindowLocation } from '@/shared/types';
import type { GameScanWarning, ModOpeningFailure } from '@/shared/types';
import { extractFileReferenceFromError } from '@/shared/lib/errors';

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

export function openGameWarningFileEditor(warning: GameScanWarning) {
  const target = warning.editTarget;
  if (!target) return null;
  const reference = extractFileReferenceFromError(warning);
  return openFileEditorWindow({
    mode: 'recovery',
    modRoot: target.modRoot,
    path: target.path,
    sessionId: null,
    line: reference?.line,
    column: reference?.column,
    title: '文件编辑器',
    contextLabel: '错误',
    contextSeverity: 'error',
    message: warning.message,
  });
}

export function openModOpeningFailureFileEditor(failure: ModOpeningFailure) {
  const target = failure.file;
  if (!target) return null;
  return openFileEditorWindow({
    mode: 'recovery',
    modRoot: failure.modRoot,
    path: target.path,
    sessionId: null,
    line: target.line,
    column: target.column,
    title: '文件编辑器',
    contextLabel: '错误',
    contextSeverity: 'error',
    message: failure.message,
  });
}

export function openFileEditorWindow(request: OpenFileEditorWindowRequest) {
  return openManagedWindow({
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
