import { invokeCommand } from '@/shared/runtime/command.runtime';
import { createLiveSessionQuery, subscribeQueryInvalidations, type QueryCacheInvalidationEvent } from './query-cache.service';
import type { EngineRenderAssets, ProjectInvalidation, RowData } from '@/shared/types';
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
  if (hasEngineAssetsInvalidation(event)) for (const key of pending.keys()) if (JSON.parse(key)[0] === event.sessionId) pending.delete(key);
});
const read = createLiveSessionQuery<{ inlineStyles: RowData[] }, EngineRenderAssets>({
  queryKind: 'engine-render-assets',
  invalidates: (_parameters, invalidation) => affected(invalidation),
  load: ({ sessionId, parameters }) => {
    const key = JSON.stringify([sessionId, parameters.inlineStyles]);
    let request = pending.get(key);
    if (!request) {
      request = invokeCommand<EngineRenderAssets>('query_engine_render_assets', { sessionId, ...parameters }).finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
      pending.set(key, request);
    }
    return request;
  },
});
export const queryEngineRenderAssets = (sessionId: string, inlineStyles: RowData[], signal?: AbortSignal) =>
  read(sessionId, { inlineStyles }, signal);
