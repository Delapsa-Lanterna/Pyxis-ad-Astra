import { openManagedWindow } from '@/windows/managed.window';
import type { WeaponFirePreviewSource } from '@/shared/types';
export function weaponFirePreviewWindowTitle(id: string) {
  return '发射预览 - ' + id;
}
export function openWeaponFirePreviewWindow(request: { sessionId: string; modRoot: string; id: string; source: WeaponFirePreviewSource }) {
  return openManagedWindow({
    identity: { type: 'weapon-fire-preview', sessionId: request.sessionId, modRoot: request.modRoot, id: request.id },
    title: weaponFirePreviewWindowTitle(request.id),
    input: { kind: 'weapon-fire-preview', source: request.source },
    size: { width: 1120, height: 760, minWidth: 760, minHeight: 520 },
  });
}
