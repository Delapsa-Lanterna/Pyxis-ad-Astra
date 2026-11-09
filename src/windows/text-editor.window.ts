import { requestWindow } from '@/windows/managed.window';
import type { TextWindowLocation } from '@/shared/types';

export interface TextEditorRequest {
  mode?: 'session' | 'recovery';
  modRoot: string | null;
  path: string;
  sessionId: string | null;
  title?: string;
  contextLabel?: string;
  contextSeverity?: TextWindowLocation['contextSeverity'];
  message?: string;
  line?: number;
  column?: number;
}

export type OpenTextEditorWindowRequest = TextEditorRequest;

export function openTextEditorWindow(request: OpenTextEditorWindowRequest) {
  return requestWindow({
    identity:
      request.mode === 'recovery'
        ? { type: 'recovery', modRoot: request.modRoot, path: request.path }
        : { type: 'text-editor', sessionId: request.sessionId!, modRoot: request.modRoot!, path: request.path },
    title: request.title ?? '文本编辑器',
    input: {
      kind: 'text-editor',
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
