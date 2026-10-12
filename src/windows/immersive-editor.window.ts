import { openManagedWindow } from '@/windows/managed.window';
import type { JointEditRoot, AppSettings } from '@/shared/types';

export function immersiveWindowTitle(root: JointEditRoot): string {
  const label = { ship: '舰船', weapon: '武器', wing: '战机', variant: '装配' }[root.kind];
  return `${label}沉浸式编辑器 - ${root.id}`;
}

export function openImmersiveEditorWindow(root: JointEditRoot, settings: AppSettings, rowKey?: string): Promise<void> {
  return openManagedWindow({
    identity: { type: 'immersive', ...root },
    title: immersiveWindowTitle(root),
    urlParams: { window: 'immersive-editor', ...root, ...(rowKey ? { rowKey } : {}), settings: JSON.stringify(settings) },
    size:
      root.kind === 'weapon' || root.kind === 'wing'
        ? { width: 430, height: 700, minWidth: 340, minHeight: 480 }
        : { width: 830, height: 700, minWidth: 430, minHeight: 480 },
  });
}
