import { publishWindowContext } from '@/windows/window-context.window';
import { querySpecEditorIdentityIntent } from '@/services/spec-editor.service';
import { reserveNativeWindowTargets, retargetNativeWindow } from '@/services/window.service';
import { focusEntityIdentityConflict } from '@/orchestrators/window-target-focus.orchestrator';
import { specEditorWindowTitle } from '@/domain/spec-editor/spec-editor-definitions';
import type { EntityEditTarget, SpecEditorKind, RowData, WindowIdentity } from '@/shared/types';

export async function retargetEntityWindow(sessionId: string, modRoot: string, kind: SpecEditorKind, id: string) {
  const identity: WindowIdentity = { type: 'spec', sessionId, modRoot, kind, id };
  publishWindowContext(await retargetNativeWindow(identity, specEditorWindowTitle(kind, id)));
}

export async function reserveEntityIntent(sessionId: string, modRoot: string, source: EntityEditTarget, draft: RowData) {
  const intent = await querySpecEditorIdentityIntent(sessionId, source, draft).catch(async (error) => {
    await focusEntityIdentityConflict(sessionId, modRoot, error);
    throw error;
  });
  const kind = source.kind as SpecEditorKind;
  const identities: WindowIdentity[] = [
    { type: 'spec', sessionId, modRoot, kind, id: intent.nextId },
    { type: 'file', sessionId, modRoot, path: intent.nextWrite.path },
  ];
  if (source.state === 'create' || source.id !== intent.nextId || source.write.path !== intent.nextWrite.path)
    await reserveNativeWindowTargets(identities);
  return intent;
}
