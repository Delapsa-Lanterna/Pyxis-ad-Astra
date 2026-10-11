import { openManagedWindow } from '@/windows/managed.window';
import type { JointEditRoot, AppSettings } from '@/shared/types';

export function immersiveWindowTitle(root: JointEditRoot): string {
  const label = { ship: '舰船', weapon: '武器', wing: '战机', variant: '装配' }[root.kind];
  return `${label}沉浸式编辑器 - ${root.id}`;
}

export function openImmersiveEditorWindow(root: JointEditRoot, settings: AppSettings): Promise<void> {
  return openManagedWindow({
    identity: { type: 'immersive', ...root },
    title: immersiveWindowTitle(root),
    urlParams: { window: 'immersive-editor', ...root, settings: JSON.stringify(settings) },
    size: { width: 1160, height: 760, minWidth: 860, minHeight: 560 },
  });
}
