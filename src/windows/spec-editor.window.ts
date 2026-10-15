import { openManagedWindow } from '@/windows/managed.window';
import type { SpecEditorKind, ProjectSessionId, WindowRequestReceipt } from '@/shared/types/index';
import { specEditorWindowDefinition, specEditorWindowTitle } from '@/domain/spec-editor/spec-editor-definitions';
export interface SpecEditorWindowRequest {
  kind: SpecEditorKind;
  sessionId: ProjectSessionId;
  modRoot: string;
  id: string;
  starsectorRoot?: string | null;
  title?: string;
}
export function openSpecEditorWindow(request: SpecEditorWindowRequest): Promise<WindowRequestReceipt> {
  const definition = specEditorWindowDefinition(request.kind);
  return openManagedWindow({
    identity: { type: 'spec', sessionId: request.sessionId, kind: request.kind, modRoot: request.modRoot, id: request.id },
    title: request.title ?? specEditorWindowTitle(request.kind, request.id),
    input: { kind: 'editor', starsectorRoot: request.starsectorRoot ?? null },
    size: definition.size,
  });
}
export function openSpecProjectileEditorWindow(request: Omit<SpecEditorWindowRequest, 'kind'>) {
  return openSpecEditorWindow({ ...request, kind: 'projectile' });
}
