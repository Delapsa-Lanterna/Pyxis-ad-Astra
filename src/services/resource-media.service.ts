import { readonly, shallowRef, type ShallowRef } from 'vue';
import type {
  ProjectInvalidation,
  ProjectSessionId,
  ResourceDataUrlBatchPayload,
  ResourceDataUrlBatchResult,
  ResourceRef,
} from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { requireProjectionReady } from '@/services/project-projection.service';
import { normalizeFsPath } from '@/shared/lib/paths';
import { sameResourceRef } from '@/shared/lib/resource-ref';
import { AppError } from '@/shared/lib/errors';
import { createResidentCache } from '@/shared/runtime/resident-cache';
import { createReadTicket, waitForRead, invalidatedRead, type ReadTicket } from '@/shared/runtime/read-request';
import { windowCacheLimits } from '@/shared/runtime/cache-limits';
import { recordPerformance } from '@/shared/runtime/performance';

export const RESOURCE_MEDIA_FLUSH_DELAY_MS = 25;
export const mediaIdleEntryLimit = () => windowCacheLimits().mediaData.entries;
export const mediaIdleByteLimit = () => windowCacheLimits().mediaData.MiB * 1024 * 1024;
export interface ResourceMediaInvalidationEvent {
  invalidation: ProjectInvalidation | null;
  resources: ResourceRef[];
  sessionId: ProjectSessionId;
  scope: 'resources' | 'session';
}
export interface ResourceMediaLease {
  dataUrl: Readonly<ShallowRef<string | null | undefined>>;
  ready: Promise<string | null>;
  release(): void;
}
interface MediaEntry {
  sessionId: string;
  resource: ResourceRef;
  key: string;
  value: ShallowRef<string | null | undefined>;
  references: number;
  request: ReadTicket<string | null> | null;
}
interface QueuedMedia {
  entry: MediaEntry;
  resolve(value: string | null): void;
  reject(error: unknown): void;
}
const retained = createResidentCache<MediaEntry>(() => ({ entries: mediaIdleEntryLimit(), bytes: mediaIdleByteLimit() }));
const working = new Map<string, MediaEntry>();
const queued = new Map<string, QueuedMedia>();
const listeners = new Set<(event: ResourceMediaInvalidationEvent) => void>();
let flushHandle: ReturnType<typeof setTimeout> | null = null;

export function mediaResourceKey(sessionId: string, resource: Pick<ResourceRef, 'source' | 'relPath'>): string {
  return JSON.stringify([sessionId, resource.source, normalizeFsPath(resource.relPath)]);
}
function request(entry: MediaEntry): Promise<string | null> {
  if (entry.value.value !== undefined) return Promise.resolve(entry.value.value);
  if (entry.request) return entry.request.promise;
  const ticket = createReadTicket({ sessionId: entry.sessionId, resource: entry.resource }, (signal) =>
    new Promise<string | null>((resolve, reject) => queued.set(entry.key, { entry, resolve, reject })).then((value) => {
      if (signal.aborted) throw invalidatedRead({ sessionId: entry.sessionId, resource: entry.resource }, 'project');
      requireProjectionReady(entry.sessionId);
      entry.value.value = value;
      retained.put(entry.key, entry, value?.length ?? 0, entry.references);
      return value;
    }),
  );
  entry.request = ticket;
  function settled() {
    if (entry.request === ticket) entry.request = null;
    if (!entry.references && working.get(entry.key) === entry) working.delete(entry.key);
  }
  void ticket.promise.then(settled, settled);
  if (flushHandle === null)
    flushHandle = setTimeout(() => {
      flushHandle = null;
      dispatch([...queued.values()]);
    }, RESOURCE_MEDIA_FLUSH_DELAY_MS);
  return ticket.promise;
}
function dispatch(items: QueuedMedia[]) {
  const batches = new Map<string, QueuedMedia[]>();
  for (const item of items) {
    queued.delete(item.entry.key);
    const batch = batches.get(item.entry.sessionId) ?? [];
    batch.push(item);
    batches.set(item.entry.sessionId, batch);
  }
  if (!queued.size && flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  for (const [sessionId, batch] of batches) {
    const resources = batch.map((item) => item.entry.resource),
      started = performance.now();
    void invokeCommand<ResourceDataUrlBatchResult>('query_resource_data_urls', {
      payload: { sessionId, resources } satisfies ResourceDataUrlBatchPayload,
    })
      .then((result) => {
        if (
          result.entries.length !== resources.length ||
          result.entries.some(
            (item, index) => !sameResourceRef(item, resources[index]!) || (item.dataUrl !== null && typeof item.dataUrl !== 'string'),
          )
        )
          throw new AppError('资源批量查询返回内容与请求不一致', { action: 'query-resource-data-urls' });
        recordPerformance('frontend.media.readBatch', performance.now() - started, {
          requested: resources.length,
          resolved: result.entries.filter((entry) => entry.dataUrl !== null).length,
          failed: result.entries.filter((entry) => entry.dataUrl === null).length,
        });
        batch.forEach((item, index) => item.resolve(result.entries[index]!.dataUrl));
      })
      .catch((error) => batch.forEach((item) => item.reject(error)));
  }
}
export function acquireResourceMedia(sessionId: string, resource: ResourceRef): ResourceMediaLease {
  requireProjectionReady(sessionId);
  const key = mediaResourceKey(sessionId, resource);
  let entry = working.get(key) ?? retained.get(key);
  if (!entry) entry = { sessionId, resource: { ...resource }, key, value: shallowRef(undefined), references: 0, request: null };
  working.set(key, entry);
  entry.references++;
  if (retained.get(key) === entry) retained.retain(key);
  const owned = entry;
  const consumer = owned.value.value === undefined ? createReadTicket({ sessionId, resource }, () => request(owned)) : null;
  let released = false;
  return {
    dataUrl: readonly(owned.value),
    ready: consumer?.promise ?? Promise.resolve(owned.value.value!),
    release: () => {
      if (released) return;
      released = true;
      consumer?.invalidate('consumer');
      owned.references--;
      if (retained.get(key) === owned) {
        if (
          !owned.references &&
          (!mediaIdleEntryLimit() || !mediaIdleByteLimit() || (owned.value.value?.length ?? 0) > mediaIdleByteLimit())
        )
          retained.remove(key);
        else retained.release(key);
      }
      if (!owned.references && queued.get(key)?.entry === owned) {
        queued.delete(key);
        owned.request?.invalidate('consumer');
        owned.request = null;
      }
      if (!owned.references && !owned.request && working.get(key) === owned) working.delete(key);
    },
  };
}
export async function queryResourceDataUrls(
  sessionId: string,
  resources: readonly ResourceRef[],
  signal?: AbortSignal,
): Promise<(string | null)[]> {
  if (signal?.aborted) throw invalidatedRead({ sessionId, resources }, 'consumer');
  const leases = resources.map((resource) => acquireResourceMedia(sessionId, resource));
  const keys = new Set(resources.map((resource) => mediaResourceKey(sessionId, resource)));
  dispatch([...queued.values()].filter((item) => keys.has(item.entry.key)));
  try {
    const values = await waitForRead(Promise.all(leases.map((lease) => lease.ready)), { sessionId, resources }, signal);
    requireProjectionReady(sessionId);
    return values;
  } finally {
    leases.forEach((lease) => lease.release());
  }
}
export function resourceMediaDataUrl(sessionId: string | null | undefined, resource: ResourceRef | null | undefined): string | undefined {
  if (!sessionId || !resource) return undefined;
  const key = mediaResourceKey(sessionId, resource);
  return (working.get(key) ?? retained.get(key))?.value.value ?? undefined;
}
export function subscribeResourceInvalidations(listener: (event: ResourceMediaInvalidationEvent) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function hasResourceInvalidation(event: ResourceMediaInvalidationEvent, resources: readonly ResourceRef[]): boolean {
  if (!resources.length) return false;
  if (event.scope === 'session' || event.invalidation?.session) return true;
  const keys = new Set(resources.map((resource) => mediaResourceKey(event.sessionId, resource)));
  return [...event.resources, ...(event.invalidation?.resources ?? [])].some((resource) =>
    keys.has(mediaResourceKey(event.sessionId, resource)),
  );
}
function invalidate(sessionId: string, invalidation: ProjectInvalidation | null) {
  const all = new Map([...retained.keys()].map((key) => [key, retained.get(key)!]));
  for (const [key, entry] of working) all.set(key, entry);
  const scopes =
    invalidation && !invalidation.session ? new Set(invalidation.resources.map((resource) => mediaResourceKey(sessionId, resource))) : null;
  const resources: ResourceRef[] = [];
  for (const [key, entry] of all) {
    if (entry.sessionId !== sessionId || (scopes && !scopes.has(key))) continue;
    resources.push(entry.resource);
    entry.request?.invalidate(invalidation ? 'project' : 'session');
    entry.value.value = undefined;
    working.delete(key);
    queued.delete(key);
    retained.remove(key);
  }
  if (!queued.size && flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  const event: ResourceMediaInvalidationEvent = { sessionId, resources, invalidation, scope: invalidation ? 'resources' : 'session' };
  for (const listener of listeners) listener(event);
}
export function invalidateResourceMediaForSession(sessionId: string) {
  invalidate(sessionId, null);
}
export function invalidateResourceMediaByProject(sessionId: string, invalidation: ProjectInvalidation) {
  invalidate(sessionId, invalidation);
}
export function resourceMediaStats() {
  return { ...retained.stats(), pending: [...working.values()].filter((entry) => entry.request).length };
}
export function disposeResourceMedia() {
  const sessions = new Set([...working.values()].map((entry) => entry.sessionId));
  for (const key of retained.keys()) sessions.add(retained.get(key)!.sessionId);
  for (const sessionId of sessions) invalidateResourceMediaForSession(sessionId);
}
