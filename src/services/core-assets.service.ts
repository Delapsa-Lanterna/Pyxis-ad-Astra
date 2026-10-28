import type { CoreRootPayload, CoreScanPayload, InvalidateCoreCachePayload, DiscoveredField } from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';

export function queryCoreRoot(payload: CoreRootPayload): Promise<string | null> {
  return invokeCommand('query_core_root', { payload });
}

export function queryCoreFields(starsectorRoot: string): Promise<Record<string, DiscoveredField[]>> {
  return invokeCommand('scan_core_fields', { payload: { starsectorRoot } satisfies CoreScanPayload });
}

export function queryCoreGraphics(starsectorRoot: string): Promise<string[]> {
  return invokeCommand('scan_core_graphics', { payload: { starsectorRoot } satisfies CoreScanPayload });
}

export function invalidateCoreCacheForRoot(starsectorRoot: string): Promise<void> {
  return invokeCommand('invalidate_core_cache', { payload: { starsectorRoot } satisfies InvalidateCoreCachePayload });
}
