import { onUnmounted, shallowReactive } from 'vue';
import {
  acquireResourceMedia,
  resourceMediaDataUrl,
  subscribeResourceInvalidations,
  mediaResourceKey,
  type ResourceMediaLease,
} from '@/services/resource-media.service';
import { isReadInvalidated } from '@/shared/runtime/read-request';
import type { ResourceRef } from '@/shared/types';

interface MediaReference {
  resource: ResourceRef;
  count: number;
  lease: ResourceMediaLease | null;
}

export interface MediaCollectionChange {
  id: string;
  resources: readonly ResourceRef[];
}

export function useResourceMediaRegistry(options: {
  onError: (error: unknown) => void;
  onFailures: (resources: readonly ResourceRef[]) => void;
}) {
  const collections = new Map<string, Map<string, ResourceRef>>();
  const references = shallowReactive(new Map<string, MediaReference>());
  const reportedFailures = new Set<string>();
  let sessionId: string | null = null;

  function clear() {
    for (const entry of references.values()) entry.lease?.release();
    references.clear();
    collections.clear();
    reportedFailures.clear();
  }

  async function read(keys: readonly string[]): Promise<void> {
    const capturedSession = sessionId!;
    let reportedError = false;
    const failures: ResourceRef[] = [];
    await Promise.all(
      keys.map(async (key) => {
        const previous = references.get(key)!;
        const lease = previous.lease ?? acquireResourceMedia(capturedSession, previous.resource);
        const entry = previous.lease ? previous : { ...previous, lease };
        if (entry !== previous) references.set(key, entry);
        try {
          const value = await lease.ready;
          if (references.get(key) === entry && entry.lease === lease && value === null && !reportedFailures.has(key)) {
            reportedFailures.add(key);
            failures.push(entry.resource);
          }
        } catch (error) {
          if (references.get(key) !== entry || entry.lease !== lease) return;
          lease.release();
          entry.lease = null;
          if (!isReadInvalidated(error) && !reportedError) {
            reportedError = true;
            options.onError(error);
          }
        }
      }),
    );
    if (failures.length) options.onFailures(failures);
  }

  function replaceCollections(nextSession: string | null | undefined, changes: readonly MediaCollectionChange[]): Promise<void> {
    if (sessionId !== (nextSession ?? null)) {
      clear();
      sessionId = nextSession ?? null;
    }
    if (!sessionId) return Promise.resolve();
    const deltas = new Map<string, { resource: ResourceRef; count: number }>();
    const requestedKeys = new Set<string>();
    const createdKeys = new Set<string>();
    function changeCount(key: string, resource: ResourceRef, count: number) {
      const current = deltas.get(key);
      deltas.set(key, { resource, count: (current?.count ?? 0) + count });
    }
    for (const change of changes) {
      const previous = collections.get(change.id);
      const next = new Map(change.resources.map((resource) => [mediaResourceKey(sessionId!, resource), resource]));
      for (const key of next.keys()) requestedKeys.add(key);
      for (const [key, resource] of previous ?? []) if (!next.has(key)) changeCount(key, resource, -1);
      for (const [key, resource] of next) if (!previous?.has(key)) changeCount(key, resource, 1);
      if (next.size) collections.set(change.id, next);
      else collections.delete(change.id);
    }
    for (const [key, delta] of deltas) {
      let entry = references.get(key);
      if (!entry) {
        entry = { resource: delta.resource, count: 0, lease: acquireResourceMedia(sessionId, delta.resource) };
        createdKeys.add(key);
      }
      entry.count += delta.count;
      if (entry.count === 0) {
        entry.lease?.release();
        references.delete(key);
      } else {
        references.set(key, entry);
      }
    }
    const missing = [...requestedKeys].filter((key) => references.has(key) && (createdKeys.has(key) || !references.get(key)!.lease));
    return missing.length ? read(missing) : Promise.resolve();
  }

  const stopInvalidation = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.scope === 'session') {
      clear();
      sessionId = null;
      return;
    }
    const keys = event.invalidation?.session
      ? [...references.keys()]
      : [
          ...new Set(
            [...event.resources, ...(event.invalidation?.resources ?? [])].map((resource) => mediaResourceKey(event.sessionId, resource)),
          ),
        ];
    const affected = keys.filter((key) => references.has(key));
    for (const key of affected) {
      references.get(key)!.lease?.release();
      references.get(key)!.lease = null;
      reportedFailures.delete(key);
    }
    if (affected.length) void read(affected);
  });

  onUnmounted(() => {
    stopInvalidation();
    clear();
  });

  return {
    replaceCollections,
    replaceCollection: (session: string | null | undefined, id: string, resources: readonly ResourceRef[]) =>
      replaceCollections(session, [{ id, resources }]),
    releaseCollection: (id: string) => replaceCollections(sessionId, [{ id, resources: [] }]),
    clear,
    dataUrl: (session: string | null | undefined, resource: ResourceRef | null | undefined) =>
      (session && resource ? references.get(mediaResourceKey(session, resource))?.lease?.dataUrl.value : undefined) ??
      resourceMediaDataUrl(session, resource),
  };
}
