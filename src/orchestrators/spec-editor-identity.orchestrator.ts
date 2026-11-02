import { publishWindowContext } from '@/windows/window-context.window';
import { querySpecEditorIdentityIntent } from '@/services/spec-editor.service';
import { reserveNativeWindowTargets, retargetNativeWindow } from '@/services/window.service';
import { focusEntityIdentityConflict } from '@/orchestrators/window-target-focus.orchestrator';
import { chooseEntityFilename } from '@/orchestrators/entity-write.orchestrator';
import { specEditorWindowTitle } from '@/domain/spec-editor/spec-editor-definitions';
import type { AppFeedback, EntityEditTarget, SpecEditorKind, RowData, WindowIdentity } from '@/shared/types';

export async function retargetEntityWindow(sessionId: string, modRoot: string, kind: SpecEditorKind, id: string) {
  const identity: WindowIdentity = { type: 'spec', sessionId, modRoot, kind, id };
  publishWindowContext(await retargetNativeWindow(identity, specEditorWindowTitle(kind, id)));
}

/**
 * Captures the identity intent of a spec save, settles the file name and reserves the renamed windows.
 * Returns null when the save is cancelled; `intent` is null when the file keeps its current name.
 */
export async function reserveEntityIntent(
  sessionId: string,
  modRoot: string,
  source: EntityEditTarget,
  draft: RowData,
  feedback: AppFeedback | undefined,
) {
  const intent = await querySpecEditorIdentityIntent(sessionId, source, draft).catch(async (error) => {
    await focusEntityIdentityConflict(sessionId, modRoot, error);
    throw error;
  });
  const keepFilename = await chooseEntityFilename(feedback, source, intent);
  if (keepFilename === null) return null;
  if (keepFilename) return { keepFilename, intent: null };
  const kind = source.kind as SpecEditorKind;
  const identities: WindowIdentity[] = [
    { type: 'spec', sessionId, modRoot, kind, id: intent.nextId },
    { type: 'file', sessionId, modRoot, path: intent.nextWrite.path },
  ];
  if (source.state === 'create' || source.id !== intent.nextId || source.write.path !== intent.nextWrite.path)
    await reserveNativeWindowTargets(identities);
  return { keepFilename, intent };
}
