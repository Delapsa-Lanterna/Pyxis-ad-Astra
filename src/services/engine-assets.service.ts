import { invokeCommand } from '@/shared/runtime/command.runtime';
import { readLiveSessionQuery, type SessionQueryDefinition, subscribeQueryInvalidations } from './query-cache.service';
import type { EngineRenderAssets, ProjectInvalidation, RowData } from '@/shared/types';
import { normalizeFsPath } from '@/shared/lib/paths';

const pending = new Map<string, Promise<EngineRenderAssets>>();
export function hasEngineAssetsInvalidation(invalidation: ProjectInvalidation) {
  return (
    invalidation.session ||
    invalidation.resources.some(({ relPath }) => {
      const path = normalizeFsPath(relPath),
        target = 'data/config/engine_styles.json';
      return path === target || target.startsWith(path + '/');
    })
  );
}
subscribeQueryInvalidations((event) => {
  if (event.scope === 'session' || (event.invalidation && hasEngineAssetsInvalidation(event.invalidation)))
    for (const key of pending.keys()) if (JSON.parse(key)[0] === event.sessionId) pending.delete(key);
});
const read = {
  queryKind: 'engine-render-assets',
  invalidates: (_parameters, invalidation) => hasEngineAssetsInvalidation(invalidation),
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
} satisfies SessionQueryDefinition<{ inlineStyles: RowData[] }, EngineRenderAssets>;
export const queryEngineRenderAssets = (sessionId: string, inlineStyles: RowData[], signal?: AbortSignal) =>
  readLiveSessionQuery(read, sessionId, { inlineStyles }, signal);
