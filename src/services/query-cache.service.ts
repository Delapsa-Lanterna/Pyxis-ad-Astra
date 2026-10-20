import { recordPerformance } from '@/shared/runtime/performance';
import { requireProjectionReady } from '@/services/project-projection.service';
import { createRuntimeCache } from '@/shared/runtime/cache';
import { subscribeCacheLimits, windowCacheLimits } from '@/shared/runtime/cache-limits';
import { stableStringify } from '@/shared/lib/stable-compare';
import { deepClone } from '@/shared/lib/starsector';
import { createReadTicket, waitForRead, invalidatedRead, type ReadTicket } from '@/shared/runtime/read-request';
import type { QueryCacheKey, SessionQueryIdentity, DeepReadonly, ProjectInvalidation } from '@/shared/types';

interface SessionQueryDefinition<TParameters extends object, TResult> {
  queryKind: string;
  load: (identity: SessionQueryIdentity<TParameters>) => Promise<TResult>;
  invalidates: (parameters: TParameters, invalidation: ProjectInvalidation) => boolean;
}
type SessionQuery<TParameters extends object, TResult> = (
  sessionId: string,
  parameters: TParameters,
  signal?: AbortSignal,
) => Promise<DeepReadonly<TResult>>;
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

export function createCachedSessionQuery<TParameters extends object, TResult>(
  definition: SessionQueryDefinition<TParameters, TResult> & { queryKind: QueryCacheKey },
): SessionQuery<TParameters, TResult> {
  type Entry = { identity: SessionQueryIdentity<TParameters>; value: DeepReadonly<TResult> };
  type Pending = { identity: SessionQueryIdentity<TParameters>; request: ReadTicket<TResult>; promise: Promise<DeepReadonly<TResult>> };
  const cache = createRuntimeCache<string, Entry, Pending>({ capacity: () => windowCacheLimits().queries[definition.queryKind] });
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
  return async (sessionId, parameters, signal) => {
    const identity = deepClone({ sessionId, queryKind: definition.queryKind, parameters });
    if (signal?.aborted) throw invalidatedRead(identity, 'consumer');
    requireProjectionReady(sessionId);
    const key = JSON.stringify([sessionId, definition.queryKind, stableStringify(identity.parameters)]);
    const startedAt = performance.now();
    const cached = cache.get(key);
    if (cached) {
      recordPerformance('frontend.queryCache', performance.now() - startedAt, { queryKind: definition.queryKind, hit: true });
      return waitForRead(Promise.resolve(cached.value), identity, signal);
    }
    const pending = cache.getPending(key);
    if (pending) {
      recordPerformance('frontend.queryCache', performance.now() - startedAt, {
        queryKind: definition.queryKind,
        hit: true,
        pending: true,
      });
      return waitForRead(pending.promise, identity, signal);
    }
    const request = createReadTicket(identity, () => definition.load(identity));
    const completed = request.promise
      .then((result) => {
        request.accept();
        requireProjectionReady(sessionId);
        const value = result as DeepReadonly<TResult>;
        if (cache.getPending(key)?.request === request) cache.set(key, { identity, value });
        return value;
      })
      .finally(() => {
        if (cache.getPending(key)?.request === request) cache.deletePending(key);
      });
    cache.setPending(key, { identity, request, promise: completed });
    const value = await waitForRead(completed, identity, signal);
    recordPerformance('frontend.queryCache', performance.now() - startedAt, { queryKind: definition.queryKind, hit: false });
    return value;
  };
}

export function createLiveSessionQuery<TParameters extends object, TResult>(
  definition: SessionQueryDefinition<TParameters, TResult>,
): SessionQuery<TParameters, TResult> {
  return async (sessionId, parameters, signal) => {
    const identity = deepClone({ sessionId, queryKind: definition.queryKind, parameters });
    if (signal?.aborted) throw invalidatedRead(identity, 'consumer');
    requireProjectionReady(sessionId);
    const request = createReadTicket(identity, () => definition.load(identity));
    const entry: LiveQuery = {
      identity,
      request,
      invalidates: (invalidation) => definition.invalidates(identity.parameters, invalidation),
    };
    liveQueries.add(entry);
    const completed = request.promise
      .then((value) => {
        request.accept();
        requireProjectionReady(sessionId);
        return value as DeepReadonly<TResult>;
      })
      .finally(() => liveQueries.delete(entry));
    return waitForRead(completed, identity, signal);
  };
}

function invalidateQueries(sessionId: string, invalidation: ProjectInvalidation | null) {
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
