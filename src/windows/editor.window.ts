import { openManagedWindow } from '@/windows/managed.window';
import type { EditorWindowKind, ProjectSessionId, WindowRequestReceipt } from '@/shared/types';
import { editorWindowDefinition, editorWindowTitle } from '@/domain/editors/editor-definitions';
export interface EditorWindowRequest {
  kind: EditorWindowKind;
  sessionId: ProjectSessionId;
  modRoot: string;
  id: string;
  starsectorRoot?: string | null;
  title?: string;
}
export function openEditorWindow(request: EditorWindowRequest): Promise<WindowRequestReceipt> {
  const definition = editorWindowDefinition(request.kind);
  return openManagedWindow({
    identity: { type: 'spec', sessionId: request.sessionId, kind: request.kind, modRoot: request.modRoot, id: request.id },
    title: request.title ?? editorWindowTitle(request.kind, request.id),
    input: { kind: 'editor', starsectorRoot: request.starsectorRoot ?? null },
    size: definition.size,
  });
}
export function openProjectileEditorWindow(request: Omit<EditorWindowRequest, 'kind'>) {
  return openEditorWindow({ ...request, kind: 'projectile' });
}
