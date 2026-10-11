import type { AppFeedback, AppSettings, EditWriteTarget, JointEditRoot, JointEditSnapshot } from '@/shared/types';
import { focusNativeManagedWindow, retargetNativeWindow } from '@/services/window.service';
import { openJointEditRowSnapshot, openJointEditSnapshot } from '@/orchestrators/joint-edit.orchestrator';
import { openImmersiveEditorWindow, immersiveWindowTitle } from '@/windows/immersive-editor.window';
import { publishCurrentWindowIdentity } from '@/windows/window-identity.window';
import { shipEditableRecords } from '@/domain/immersive/ship-sources';

export async function openShipImmersiveEditor(
  request: {
    root: JointEditRoot;
    rowKey: string;
    csvTarget: EditWriteTarget;
    settings: AppSettings;
  },
  feedback: AppFeedback,
): Promise<void> {
  if (await focusNativeManagedWindow({ type: 'immersive', ...request.root })) return;
  const captured = await openJointEditRowSnapshot(request.root, request.rowKey, request.csvTarget, feedback);
  if (!captured) return;
  const snapshot = await openJointEditSnapshot(captured.root, feedback, undefined, shipEditableRecords);
  if (snapshot) await openImmersiveEditorWindow(snapshot.root, request.settings);
}

export async function retargetImmersiveWindow(snapshot: JointEditSnapshot): Promise<void> {
  const identity = { type: 'immersive' as const, ...snapshot.root };
  await retargetNativeWindow(identity, immersiveWindowTitle(snapshot.root));
  publishCurrentWindowIdentity(identity);
}
