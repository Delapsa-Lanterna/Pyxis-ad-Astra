import { requestWindow } from '@/windows/managed.window';
import type { JointEditRoot } from '@/shared/types';

export function immersiveWindowTitle(root: JointEditRoot): string {
  const label = { ship: '舰船', weapon: '武器', wing: '战机联队', variant: '装配' }[root.kind];
  return `${label}沉浸式编辑器 - ${root.id}`;
}

export function openImmersiveEditorWindow(root: JointEditRoot, rowKey?: string) {
  return requestWindow({
    identity: { type: 'immersive', ...root },
    title: immersiveWindowTitle(root),
    input: { kind: 'immersive-editor', rowKey: rowKey ?? null },
    size:
      root.kind === 'variant'
        ? { width: 1280, height: 720, minWidth: 960, minHeight: 640 }
        : root.kind === 'weapon' || root.kind === 'wing'
          ? { width: 430, height: 700, minWidth: 340, minHeight: 480 }
          : { width: 830, height: 700, minWidth: 430, minHeight: 480 },
  });
}
