import { type EditorSpecSavedEvent } from '@/windows/window.events';
import { type WindowEventHandler } from '@/windows/tauri.events';
import { listenCommittedWrites } from '@/orchestrators/project-sync.orchestrator';
import { isRowData } from '@/shared/lib/row-data';

export function listenEditorSpecSaved(handler: WindowEventHandler<EditorSpecSavedEvent>) {
  return listenCommittedWrites(async (event) => {
    if (!event.sessionId) return;
    const content = event.result.content;
    if (content?.target.kind !== 'spec' || !isRowData(content.value)) return;
    const target = content.target.target;
    const kind = target.kind;
    if (kind !== 'ship' && kind !== 'weapon' && kind !== 'projectile' && kind !== 'system') return;
    await handler({
      kind,
      sessionId: event.sessionId,
      modRoot: event.modRoot,
      id: target.id,
      spec: content.value,
      writeResult: event.result,
    });
  });
}
