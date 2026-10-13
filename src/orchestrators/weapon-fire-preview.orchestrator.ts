import { retargetNativeWindow } from '@/services/window.service';
import { publishWindowContext } from '@/windows/window-context.window';
import { weaponFirePreviewWindowTitle } from '@/windows/weapon-fire-preview.window';
export async function retargetWeaponFirePreviewWindow(sessionId: string, modRoot: string, id: string) {
  publishWindowContext(
    await retargetNativeWindow({ type: 'weapon-fire-preview', sessionId, modRoot, id }, weaponFirePreviewWindowTitle(id)),
  );
}
