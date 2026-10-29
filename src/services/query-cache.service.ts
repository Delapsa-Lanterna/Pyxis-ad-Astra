import { beginPerformance, performanceMonitorEnabled } from '@/shared/runtime/performance';
import { requireProjectionReady, currentReferenceRevision, waitForReferenceSources } from '@/services/project-projection.service';
import { createRuntimeCache, type RuntimeCache } from '@/shared/runtime/cache';
import { subscribeCacheLimits, windowCacheLimits } from '@/shared/runtime/cache-limits';
import { stableStringify } from '@/shared/lib/stable-compare';
import { deepClone } from '@/shared/lib/starsector';
import { createReadTicket, waitForRead, invalidatedRead, isReadInvalidated, type ReadTicket } from '@/shared/runtime/read-request';
import type { QueryCacheKey, SessionQueryIdentity, DeepReadonly, ProjectInvalidation } from '@/shared/types';
import { beginDebug, debugLog, shouldQueueLog } from '@/shared/runtime/app-log-queue';

export interface SessionQueryDefinition<TParameters extends object, TResult> {
  queryKind: string;
  load: (identity: SessionQueryIdentity<TParameters>) => Promise<TResult>;
  invalidates: (parameters: TParameters, invalidation: ProjectInvalidation) => boolean;
}
type InvalidateCache = (sessionId: string, invalidation: ProjectInvalidation | null, queries: SessionQueryIdentity[]) => void;
interface LiveQuery {
  identity: SessionQueryIdentity;
  request: ReadTicket<unknown>;
  invalidates: (invalidation: ProjectInvalidation) => boolean;
}
export interface QueryCacheInvalidationEvent {
  invalidation: ProjectInvalidation | null;
  queries: SessionQueryIdentity[];
  sessionId: string;
  scope: 'paths' | 'session';
}
type QueryCacheInvalidationListener = (event: QueryCacheInvalidationEvent) => void;
const caches = new Set<InvalidateCache>();
const liveQueries = new Set<LiveQuery>();
const invalidationListeners = new Set<QueryCacheInvalidationListener>();

function observeQueryLoad<T>(load: () => Promise<T>, signal: AbortSignal, queryKind: string): Promise<T> {
  const result = load();
  if (!shouldQueueLog('debug')) return result;
  return result.then((value) => {
    if (signal.aborted) debugLog('query.late_result', () => ({ queryKind }));
    return value;
  });
}

function observeSessionQuery<TResult>(
  queryKind: string,
  cache: string,
  sessionId: string,
  execute: (observation?: { cache: string; queryKind: string }) => Promise<DeepReadonly<TResult>>,
): Promise<DeepReadonly<TResult>> {
  const debug = shouldQueueLog('debug');
  if (!performanceMonitorEnabled && !debug) return execute();
  const fields = { cache, queryKind, sessionId },
    finish = performanceMonitorEnabled ? beginPerformance('query', queryKind, fields) : null;
  const log = beginDebug('query', () => fields);
  const result = execute(debug || finish ? fields : undefined).then(
    (value) => {
      finish?.();
      log?.();
      return value;
    },
    (error) => {
      finish?.(isReadInvalidated(error) ? 'invalidated' : 'error');
      log?.(isReadInvalidated(error) ? 'invalidated' : 'failed');
      throw error;
    },
  );
  return result;
}

type QueryEntry<TParameters extends object, TResult> = { identity: SessionQueryIdentity<TParameters>; value: DeepReadonly<TResult> };
type QueryPending<TParameters extends object, TResult> = {
  identity: SessionQueryIdentity<TParameters>;
  request: ReadTicket<TResult>;
  promise: Promise<DeepReadonly<TResult>>;
};
export class CachedSessionQuery<TParameters extends object, TResult> {
  private readonly cache: RuntimeCache<string, QueryEntry<TParameters, TResult>, QueryPending<TParameters, TResult>>;
  constructor(private readonly definition: SessionQueryDefinition<TParameters, TResult> & { queryKind: QueryCacheKey }) {
    this.cache = createRuntimeCache<string, QueryEntry<TParameters, TResult>, QueryPending<TParameters, TResult>>({
      name: definition.queryKind,
      capacity: () => windowCacheLimits().queries[definition.queryKind],
    });
    const cache = this.cache;
    subscribeCacheLimits(cache);
    caches.add((sessionId, invalidation, queries) => {
      const matches = (identity: SessionQueryIdentity<TParameters>) =>
        identity.sessionId === sessionId &&
        (!invalidation || invalidation.session || definition.invalidates(identity.parameters, invalidation));
      for (const key of [...cache.keys()]) {
        const entry = cache.peek(key)!;
        if (!matches(entry.identity)) continue;
        queries.push(entry.identity);
        cache.delete(key);
      }
      for (const key of [...cache.pendingKeys()]) {
        const entry = cache.getPending(key)!;
        if (!matches(entry.identity)) continue;
        queries.push(entry.identity);
        cache.deletePending(key);
        entry.request.invalidate(invalidation ? 'project' : 'session');
      }
    });
  }
  read(sessionId: string, parameters: TParameters, signal?: AbortSignal): Promise<DeepReadonly<TResult>> {
    return observeSessionQuery(this.definition.queryKind, 'load', sessionId, async (observation) => {
      const ready = waitForReferenceSources();
      if (ready) await ready;
      const revision = currentReferenceRevision();
      const definition = this.definition;
      const cache = this.cache;
      const identity = deepClone({ sessionId, queryKind: definition.queryKind, parameters });
      if (signal?.aborted) throw invalidatedRead(identity, 'consumer');
      requireProjectionReady(sessionId);
      const key = JSON.stringify([sessionId, definition.queryKind, stableStringify(identity.parameters), currentReferenceRevision()]);
      const cached = cache.get(key);
      if (cached) {
        if (observation) observation.cache = 'hit';
        return waitForRead(Promise.resolve(cached.value), identity, signal);
      }
      const pending = cache.getPending(key);
      if (pending) {
        if (observation) observation.cache = 'shared';
        return waitForRead(pending.promise, identity, signal);
      }
      const request = createReadTicket(identity, (signal) =>
        observeQueryLoad(() => definition.load(identity), signal, definition.queryKind),
      );
      const completed = request.promise
        .then((result) => {
          requireProjectionReady(sessionId, revision);
          request.accept();
          const value = result as DeepReadonly<TResult>;
          if (cache.getPending(key)?.request === request) cache.set(key, { identity, value });
          return value;
        })
        .finally(() => {
          if (cache.getPending(key)?.request === request) cache.deletePending(key);
        });
      cache.setPending(key, { identity, request, promise: completed });
      return await waitForRead(completed, identity, signal);
    });
  }
}

export function readLiveSessionQuery<TParameters extends object, TResult>(
  definition: SessionQueryDefinition<TParameters, TResult>,
  sessionId: string,
  parameters: TParameters,
  signal?: AbortSignal,
): Promise<DeepReadonly<TResult>> {
  return observeSessionQuery(definition.queryKind, 'live', sessionId, async () => {
    const ready = waitForReferenceSources();
    if (ready) await ready;
    const revision = currentReferenceRevision();
    const identity = deepClone({ sessionId, queryKind: definition.queryKind, parameters });
    if (signal?.aborted) throw invalidatedRead(identity, 'consumer');
    requireProjectionReady(sessionId);
    const request = createReadTicket(identity, (signal) => observeQueryLoad(() => definition.load(identity), signal, definition.queryKind));
    const entry: LiveQuery = {
      identity,
      request,
      invalidates: (invalidation) => definition.invalidates(identity.parameters, invalidation),
    };
    liveQueries.add(entry);
    const completed = request.promise
      .then((value) => {
        requireProjectionReady(sessionId, revision);
        request.accept();
        return value as DeepReadonly<TResult>;
      })
      .finally(() => liveQueries.delete(entry));
    return waitForRead(completed, identity, signal);
  });
}

function invalidateQueries(sessionId: string, invalidation: ProjectInvalidation | null) {
  debugLog('query.invalidating', () => ({ sessionId, reason: invalidation ? 'project' : 'session' }));
  const queries: SessionQueryIdentity[] = [];
  for (const invalidate of caches) invalidate(sessionId, invalidation, queries);
  for (const entry of liveQueries) {
    if (entry.identity.sessionId !== sessionId || (invalidation && !invalidation.session && !entry.invalidates(invalidation))) continue;
    queries.push(entry.identity);
    liveQueries.delete(entry);
    entry.request.invalidate(invalidation ? 'project' : 'session');
  }
  const event: QueryCacheInvalidationEvent = { invalidation, queries, sessionId, scope: invalidation ? 'paths' : 'session' };
  for (const listener of invalidationListeners) listener(event);
}
export function invalidateQueryCacheForSession(sessionId: string) {
  invalidateQueries(sessionId, null);
}
export function invalidateQueryCacheByProject(sessionId: string, invalidation: ProjectInvalidation) {
  invalidateQueries(sessionId, invalidation);
}
export function subscribeQueryInvalidations(listener: QueryCacheInvalidationListener): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}
export function hasQueryInvalidation(event: QueryCacheInvalidationEvent, queryKind: QueryCacheKey): boolean {
  return (
    event.scope === 'session' ||
    event.queries.some((query) => query.queryKind === queryKind) ||
    !!event.invalidation?.queryScopes.some((scope) => scope.kind === queryKind)
  );
}
