import { publishWindowContext } from '@/windows/window-context.window';
import { queryEditorIdentityIntent } from '@/services/editor.service';
import { reserveNativeWindowTargets, releaseNativeWindowTargets, retargetNativeWindow } from '@/services/window.service';
import { focusEntityIdentityConflict } from '@/orchestrators/window-target-focus.orchestrator';
import { editorWindowTitle } from '@/domain/editors/editor-definitions';
import type { EntityEditTarget, EditorSpecKind, EditorWindowKind, RowData, WindowIdentity } from '@/shared/types';

export async function retargetEntityWindow(sessionId: string, modRoot: string, kind: EditorWindowKind, id: string) {
  const identity: WindowIdentity = { type: 'spec', sessionId, modRoot, kind, id };
  publishWindowContext(await retargetNativeWindow(identity, editorWindowTitle(kind, id)));
}

export function releaseCommittedIdentityTargets() {
  return releaseNativeWindowTargets();
}

export async function reserveEntityIntent(sessionId: string, modRoot: string, source: EntityEditTarget, draft: RowData) {
  const intent = await queryEditorIdentityIntent(sessionId, source, draft).catch(async (error) => {
    await focusEntityIdentityConflict(sessionId, modRoot, error);
    throw error;
  });
  const kind = source.kind as EditorSpecKind;
  const identities: WindowIdentity[] = [
    { type: 'spec', sessionId, modRoot, kind, id: intent.nextId },
    { type: 'file', sessionId, modRoot, path: intent.nextWrite.path },
  ];
  if (source.state === 'create' || source.id !== intent.nextId || source.write.path !== intent.nextWrite.path)
    await reserveNativeWindowTargets(identities);
  return intent;
}

export async function reserveFileIdentityIntent(sessionId: string, modRoot: string, intent: import('@/shared/types').EntityIdentityIntent) {
  if (intent.source.id === intent.nextId && intent.source.write.path === intent.nextWrite.path) return;
  const identities: WindowIdentity[] = [{ type: 'file', sessionId, modRoot, path: intent.nextWrite.path }];
  if (['ship', 'weapon', 'projectile', 'system'].includes(intent.source.kind))
    identities.push({ type: 'spec', sessionId, modRoot, kind: intent.source.kind as EditorSpecKind, id: intent.nextId });
  await reserveNativeWindowTargets(identities);
}
export async function retargetFileWindow(sessionId: string, modRoot: string, path: string, title: string) {
  const identity: WindowIdentity = { type: 'file', sessionId, modRoot, path };
  publishWindowContext(await retargetNativeWindow(identity, title));
}
