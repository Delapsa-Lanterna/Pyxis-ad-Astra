import type { JointEditRoot, JointEditSnapshot } from '@/shared/types';
import { focusNativeManagedWindow, retargetNativeWindow } from '@/services/window.service';
import { openJointEditRowSnapshot, openJointEditSnapshot } from '@/orchestrators/joint-edit.orchestrator';
import { openImmersiveEditorWindow, immersiveWindowTitle } from '@/windows/immersive-editor.window';
import { managedWindowContext, publishWindowContext } from '@/windows/window-context.window';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

export async function openEntityImmersiveEditor(request: { root: JointEditRoot; rowKey: string }): Promise<void> {
  if (await focusNativeManagedWindow({ type: 'immersive', ...request.root })) {
    await openImmersiveEditorWindow(request.root, request.root.kind === 'wing' ? request.rowKey : undefined);
    return;
  }
  const captured = await openJointEditRowSnapshot(request.root, request.rowKey);
  if (!captured) return;
  const snapshot = await openJointEditSnapshot(captured.root);
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
  const input = {
    kind: 'immersive-editor' as const,
    rowKey: snapshot.root.kind === 'wing' && row?.target.kind === 'csv' ? row.target.rowKey : null,
  };
  const title = immersiveWindowTitle(snapshot.root);
  const current = managedWindowContext.value;
  if (current && current.title === title && stableDeepEqual(current.identity, identity) && stableDeepEqual(current.input, input)) return;
  publishWindowContext(await retargetNativeWindow(identity, title, input));
}
export async function openVariantImmersiveEditor(root: JointEditRoot): Promise<void> {
  if (await focusNativeManagedWindow({ type: 'immersive', ...root })) {
    await openImmersiveEditorWindow(root);
    return;
  }
  const snapshot = await openJointEditSnapshot(root);
  if (snapshot) await openImmersiveEditorWindow(snapshot.root);
}
