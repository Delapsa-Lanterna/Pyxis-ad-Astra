import { publishWindowContext } from '@/windows/window-context.window';
import { querySpecEditorIdentityIntent } from '@/services/spec-editor.service';
import { reserveNativeWindowTargets, retargetNativeWindow } from '@/services/window.service';
import { focusEntityIdentityConflict } from '@/orchestrators/window-target-focus.orchestrator';
import { specEditorWindowTitle } from '@/domain/spec-editor/spec-editor-definitions';
import type { EntityEditTarget, SpecEditorKind, RowData, WindowIdentity } from '@/shared/types';

export async function chooseIdentityFilename(
  feedback: import('@/shared/types').AppFeedback | undefined,
  source: EntityEditTarget,
  nextId: string,
) {
  if (!feedback || source.state === 'create' || source.id === nextId) return false;
  const nextPath = source.write.relPath.replace(/[^/]+$/, nextId + source.write.relPath.slice(source.write.relPath.lastIndexOf('.')));
  const choice = await feedback.choose({
    title: '修改 ID 后如何保存？',
    content: `当前文件：${source.write.relPath}\n改名目标：${nextPath}\n同路径基础内容随文件路径变化；保留文件名将继续匹配当前路径。`,
    choices: [
      { label: '同时改名', value: 'rename', type: 'warning' },
      { label: '保留文件名', value: 'keep' },
    ],
  });
  return choice === null ? null : choice === 'keep';
}

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

export async function reserveFileIdentityIntent(sessionId: string, modRoot: string, intent: import('@/shared/types').EntityIdentityIntent) {
  if (intent.source.id === intent.nextId && intent.source.write.path === intent.nextWrite.path) return;
  const identities: WindowIdentity[] = [{ type: 'file', sessionId, modRoot, path: intent.nextWrite.path }];
  if (['ship', 'weapon', 'projectile', 'system'].includes(intent.source.kind))
    identities.push({ type: 'spec', sessionId, modRoot, kind: intent.source.kind as SpecEditorKind, id: intent.nextId });
  await reserveNativeWindowTargets(identities);
}
export async function retargetFileWindow(sessionId: string, modRoot: string, path: string, title: string) {
  const identity: WindowIdentity = { type: 'file', sessionId, modRoot, path };
  publishWindowContext(await retargetNativeWindow(identity, title));
}
