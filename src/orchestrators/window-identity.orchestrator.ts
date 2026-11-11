import { publishWindowContext } from '@/windows/window-context.window';
import { reserveNativeWindowTargets, retargetNativeWindow, releaseNativeWindowTargets } from '@/services/window.service';
import type { WindowIdentity, SpecEditorKind, EntityIdentityIntent, EditWriteTarget } from '@/shared/types';
export async function withFileTargets<T>(targets: EditWriteTarget[], action: () => Promise<T>): Promise<T> {
  await reserveNativeWindowTargets(targets.map((target) => ({ type: 'text-editor' as const, ...target })));
  try {
    return await action();
  } finally {
    await releaseNativeWindowTargets();
  }
}
export async function reserveFileIdentityIntent(sessionId: string, modRoot: string, intent: EntityIdentityIntent) {
  if (intent.source.id === intent.nextId && intent.source.write.path === intent.nextWrite.path) return;
  const identities: WindowIdentity[] = [{ type: 'text-editor', sessionId, modRoot, path: intent.nextWrite.path }];
  if (['ship', 'weapon', 'projectile', 'system'].includes(intent.source.kind))
    identities.push({ type: 'spec', sessionId, modRoot, kind: intent.source.kind as SpecEditorKind, id: intent.nextId });
  await reserveNativeWindowTargets(identities);
}
export async function retargetTextEditorWindow(sessionId: string, modRoot: string, path: string, title: string) {
  const identity: WindowIdentity = { type: 'text-editor', sessionId, modRoot, path };
  publishWindowContext(await retargetNativeWindow(identity, title));
}
