import { invokeCommand } from '@/shared/runtime/command.runtime';
import { createLiveSessionQuery, subscribeQueryInvalidations, type QueryCacheInvalidationEvent } from './query-cache.service';
import type { EngineRenderAssets, ProjectInvalidation } from '@/shared/types';
import { normalizeFsPath } from '@/shared/lib/paths';

const pending = new Map<string, Promise<EngineRenderAssets>>();
function affected(invalidation: ProjectInvalidation) {
  return (
    invalidation.session ||
    invalidation.resources.some(({ relPath }) => {
      const path = normalizeFsPath(relPath),
        target = 'data/config/engine_styles.json';
      return path === target || target.startsWith(path + '/');
    })
  );
}
export function hasEngineAssetsInvalidation(event: QueryCacheInvalidationEvent) {
  return event.scope === 'session' || Boolean(event.invalidation && affected(event.invalidation));
}
subscribeQueryInvalidations((event) => {
  if (hasEngineAssetsInvalidation(event)) pending.delete(event.sessionId);
});
const read = createLiveSessionQuery<Record<string, never>, EngineRenderAssets>({
  queryKind: 'engine-render-assets',
  invalidates: (_parameters, invalidation) => affected(invalidation),
  load: ({ sessionId }) => {
    let request = pending.get(sessionId);
    if (!request) {
      request = invokeCommand<EngineRenderAssets>('query_engine_render_assets', { sessionId }).finally(() => {
        if (pending.get(sessionId) === request) pending.delete(sessionId);
      });
      pending.set(sessionId, request);
    }
    return request;
  },
});
export const queryEngineRenderAssets = (sessionId: string, signal?: AbortSignal) => read(sessionId, {}, signal);
