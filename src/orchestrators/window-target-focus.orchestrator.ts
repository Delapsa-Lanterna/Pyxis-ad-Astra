import { SPEC_EDITOR_KINDS } from '@/shared/types';
import { focusNativeManagedWindow } from '@/services/window.service';
import { AppError, errorCodeOf } from '@/shared/lib/errors';
import type { EntityEditTarget } from '@/shared/types';
import { querySessionEntityEditTarget } from '@/services/entity-query.service';

export async function focusExistingEntityWindow(sessionId: string, modRoot: string, kind: EntityEditTarget['kind'], id: string) {
  const info = await querySessionEntityEditTarget(sessionId, kind, id);
  return focusEntityWindowTarget(sessionId, modRoot, info.target);
}

export async function focusEntityWindowTarget(sessionId: string, modRoot: string, target: EntityEditTarget): Promise<boolean> {
  const kind = SPEC_EDITOR_KINDS.find((kind) => kind === target.kind);
  if (kind) {
    const focused = await focusNativeManagedWindow({ type: 'spec', sessionId, modRoot, kind, id: target.id });
    if (focused) return true;
  }
  return focusNativeManagedWindow({ type: 'text-editor', sessionId, modRoot, path: target.write.path });
}

export async function focusEntityIdentityConflict(sessionId: string, modRoot: string, error: unknown): Promise<void> {
  if (error instanceof AppError && error.cause !== undefined) return focusEntityIdentityConflict(sessionId, modRoot, error.cause);
  if (errorCodeOf(error) !== 'spec.target_exists' || typeof error !== 'object' || error === null || !('target' in error)) return;
  await focusEntityWindowTarget(sessionId, modRoot, error.target as EntityEditTarget);
}
