import type { AppFeedback, AppSettings, EditWriteTarget, JointEditRoot, JointEditSnapshot } from '@/shared/types';
import { focusNativeManagedWindow, retargetNativeWindow } from '@/services/window.service';
import { openJointEditRowSnapshot, openJointEditSnapshot } from '@/orchestrators/joint-edit.orchestrator';
import { openImmersiveEditorWindow, immersiveWindowTitle } from '@/windows/immersive-editor.window';
import { publishWindowContext } from '@/windows/window-context.window';
import { immersiveEditableRecords } from '@/domain/immersive/source-records';
import { openProjectileEditorWindow } from '@/windows/editor.window';
import { jointObject } from '@/domain/joint-edit';
import type { JointValue } from '@/shared/types';
import { schemaStringValue } from '@/domain/schema/schema-values';

export function openImmersiveProjectile(snapshot: JointEditSnapshot, values: Record<string, JointValue>, settings: AppSettings) {
  const id = schemaStringValue(jointObject(values[snapshot.bindings.spec!]).projectileSpecId);
  return openProjectileEditorWindow({
    sessionId: snapshot.root.sessionId,
    modRoot: snapshot.root.modRoot,
    id,
    starsectorRoot: settings.starsectorRoot,
  });
}

export async function openEntityImmersiveEditor(
  request: {
    root: JointEditRoot;
    rowKey: string;
    csvTarget: EditWriteTarget;
  },
  feedback: AppFeedback,
): Promise<void> {
  if (await focusNativeManagedWindow({ type: 'immersive', ...request.root })) {
    await openImmersiveEditorWindow(request.root, request.root.kind === 'wing' ? request.rowKey : undefined);
    return;
  }
  const captured = await openJointEditRowSnapshot(request.root, request.rowKey, request.csvTarget, feedback);
  if (!captured) return;
  const snapshot = await openJointEditSnapshot(captured.root, feedback, undefined, immersiveEditableRecords);
  if (snapshot) {
    const row = snapshot.records.find((record) => record.key === snapshot.bindings.csv);
    await openImmersiveEditorWindow(
      snapshot.root,
      snapshot.root.kind === 'wing' && row?.target.kind === 'csv' ? row.target.rowKey : undefined,
    );
  }
}

export async function retargetImmersiveWindow(snapshot: JointEditSnapshot): Promise<void> {
  const identity = { type: 'immersive' as const, ...snapshot.root };
  const row = snapshot.records.find((record) => record.key === snapshot.bindings.csv);
  publishWindowContext(
    await retargetNativeWindow(identity, immersiveWindowTitle(snapshot.root), {
      kind: 'immersive-editor',
      rowKey: snapshot.root.kind === 'wing' && row?.target.kind === 'csv' ? row.target.rowKey : null,
    }),
  );
}
export async function openVariantImmersiveEditor(root: JointEditRoot, feedback: AppFeedback): Promise<void> {
  if (await focusNativeManagedWindow({ type: 'immersive', ...root })) {
    await openImmersiveEditorWindow(root);
    return;
  }
  const snapshot = await openJointEditSnapshot(root, feedback, undefined, immersiveEditableRecords);
  if (snapshot) await openImmersiveEditorWindow(snapshot.root);
}
