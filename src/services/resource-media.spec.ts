import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  acquireResourceMedia,
  queryResourceDataUrls,
  mediaResourceKey,
  resourceMediaStats,
  resourceMediaDataUrl,
  invalidateResourceMediaForSession,
  invalidateResourceMediaByProject,
} from './resource-media.service';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { createSettingsFixture } from '@/test/settings';
import type { ResourceRef, ProjectInvalidation, ResourceDataUrlBatchResult } from '@/shared/types';
import { installPerformanceMonitor, type PerformanceSample } from '@/shared/runtime/performance';
const mock = vi.hoisted(() => ({
  load: vi.fn(async (resources: ResourceRef[]): Promise<ResourceDataUrlBatchResult> => ({
    entries: resources.map((resource) => ({ ...resource, dataUrl: 'data:' + resource.relPath })),
  })),
}));
vi.mock('@/shared/runtime/command.runtime', () => ({
  invokeCommand: (_command: string, { payload }: { payload: { resources: ResourceRef[] } }) => mock.load(payload.resources),
}));
const resource = (relPath = 'one.png'): ResourceRef => ({ source: 'mod', relPath, ownerKind: 'ship', ownerId: relPath, key: 'sprite' });
const session = 'media-lease';
beforeEach(() => {
  vi.useFakeTimers();
  initializeCacheLimits(createSettingsFixture().cacheLimits);
});
afterEach(() => {
  invalidateResourceMediaForSession(session);
  vi.useRealTimers();
});
it('observes media readiness, cache hits and failures only when enabled', async () => {
  const clock = vi.spyOn(performance, 'now');
  await queryResourceDataUrls(session, [resource()]);
  expect(clock).not.toHaveBeenCalled();
  const samples: PerformanceSample[] = [];
  const stop = installPerformanceMonitor((sample) => samples.push(sample));
  try {
    await queryResourceDataUrls(session, [resource()]);
    await queryResourceDataUrls(session, [resource('fresh.png')]);
    mock.load.mockImplementationOnce(async (resources) => ({ entries: resources.map((resource) => ({ ...resource, dataUrl: null })) }));
    await queryResourceDataUrls(session, [resource('missing.png')]);
    mock.load.mockRejectedValueOnce(new Error('read failure'));
    await expect(queryResourceDataUrls(session, [resource('failed.png')])).rejects.toThrow('read failure');
    expect(samples.map((sample) => sample.fields)).toEqual([
      { requested: 1, hits: 1, resolved: 1, failed: 0, status: 'ok' },
      { requested: 1, hits: 0, resolved: 1, failed: 0, status: 'ok' },
      { requested: 1, hits: 0, resolved: 0, failed: 1, status: 'ok' },
      { requested: 1, hits: 0, resolved: 0, failed: 1, status: 'error' },
    ]);
    expect(samples.every((sample) => sample.category === 'media' && sample.name === 'resource.ready')).toBe(true);
  } finally {
    stop();
    clock.mockRestore();
  }
});
it('shares one physical result and budget entry across owners and direct queries', async () => {
  const limits = createSettingsFixture().cacheLimits;
  limits.mediaData.MiB = 1;
  initializeCacheLimits(limits);
  const url = 'x'.repeat(786432);
  mock.load.mockImplementationOnce(async (resources) => ({ entries: resources.map((resource) => ({ ...resource, dataUrl: url })) }));
  const first = acquireResourceMedia(session, resource()),
    second = acquireResourceMedia(session, { ...resource(), ownerId: 'another' });
  await vi.advanceTimersByTimeAsync(25);
  await Promise.all([first.ready, second.ready]);
  expect(mock.load).toHaveBeenCalledOnce();
  expect(resourceMediaStats()).toMatchObject({ activeEntries: 1, activeBytes: 786432 });
  expect(await queryResourceDataUrls(session, [resource()])).toEqual([url]);
  first.release();
  expect(second.dataUrl.value).toBe(url);
  second.release();
  expect(resourceMediaStats()).toMatchObject({ activeEntries: 0, idleBytes: 786432 });
  limits.mediaData.MiB = 0;
  initializeCacheLimits(limits);
  expect(resourceMediaStats().idleEntries).toBe(0);
});
it('takes over queued requests immediately', async () => {
  const held = acquireResourceMedia(session, resource());
  expect(await queryResourceDataUrls(session, [resource(), resource('two.png')])).toHaveLength(2);
  await held.ready;
  held.release();
  expect(mock.load).toHaveBeenCalledOnce();
  expect(mock.load.mock.calls[0]![0]).toHaveLength(2);
});
it('starts a fresh request when a queued collection is released and immediately reacquired', async () => {
  const old = acquireResourceMedia(session, resource());
  const ended = expect(old.ready).rejects.toMatchObject({ code: 'query.invalidated' });
  old.release();
  const current = acquireResourceMedia(session, resource());
  await ended;
  await vi.advanceTimersByTimeAsync(25);
  expect(await current.ready).toBe('data:one.png');
  expect(mock.load).toHaveBeenCalledOnce();
  current.release();
});
it.each([0, 1])('retains active oversized media with %s MiB idle budget', async (MiB) => {
  const limits = createSettingsFixture().cacheLimits;
  limits.mediaData.MiB = MiB;
  initializeCacheLimits(limits);
  const url = 'x'.repeat(1048577);
  mock.load.mockImplementationOnce(async (resources) => ({ entries: resources.map((resource) => ({ ...resource, dataUrl: url })) }));
  const held = acquireResourceMedia(session, resource());
  await vi.advanceTimersByTimeAsync(25);
  await held.ready;
  expect(held.dataUrl.value).toBe(url);
  expect(resourceMediaStats().activeEntries).toBe(1);
  held.release();
  held.release();
  expect(resourceMediaStats()).toMatchObject({ activeEntries: 0, idleEntries: 0, idleBytes: 0 });
});
it('retains null until invalidation and retries thrown failures', async () => {
  mock.load.mockImplementationOnce(async (resources) => ({ entries: resources.map((resource) => ({ ...resource, dataUrl: null })) }));
  expect(await queryResourceDataUrls(session, [resource()])).toEqual([null]);
  expect(await queryResourceDataUrls(session, [resource()])).toEqual([null]);
  expect(mock.load).toHaveBeenCalledOnce();
  invalidateResourceMediaForSession(session);
  mock.load.mockRejectedValueOnce(new Error('transport'));
  await expect(queryResourceDataUrls(session, [resource()])).rejects.toThrow('transport');
  expect(await queryResourceDataUrls(session, [resource()])).toEqual(['data:one.png']);
});
it('evicts missing records through the shared idle entry limit', async () => {
  const limits = createSettingsFixture().cacheLimits;
  limits.mediaData.entries = 1;
  initializeCacheLimits(limits);
  mock.load.mockImplementationOnce(async (resources) => ({ entries: resources.map((resource) => ({ ...resource, dataUrl: null })) }));
  await queryResourceDataUrls(session, [resource()]);
  await queryResourceDataUrls(session, [resource('two.png')]);
  expect(await queryResourceDataUrls(session, [resource()])).toEqual(['data:one.png']);
  expect(mock.load).toHaveBeenCalledTimes(3);
});
it('releases only the owning wait and cancels unused queued work', async () => {
  const first = acquireResourceMedia(session, resource()),
    second = acquireResourceMedia(session, resource());
  const ended = expect(first.ready).rejects.toMatchObject({ code: 'query.invalidated' });
  first.release();
  await ended;
  await vi.advanceTimersByTimeAsync(25);
  await second.ready;
  expect(second.dataUrl.value).toBe('data:one.png');
  second.release();
  const cancelled = acquireResourceMedia(session, resource('cancelled.png'));
  const rejected = expect(cancelled.ready).rejects.toMatchObject({ code: 'query.invalidated' });
  cancelled.release();
  await rejected;
  await vi.advanceTimersByTimeAsync(25);
  expect(mock.load).toHaveBeenCalledOnce();
});
it('rejects old generations and discards their late results', async () => {
  let complete!: (result: ResourceDataUrlBatchResult) => void;
  mock.load.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const old = queryResourceDataUrls(session, [resource()]);
  const ended = expect(old).rejects.toMatchObject({ code: 'query.invalidated' });
  invalidateResourceMediaByProject(session, { session: false, resources: [{ source: 'mod', relPath: 'one.png' }] } as ProjectInvalidation);
  await ended;
  expect(await queryResourceDataUrls(session, [resource()])).toEqual(['data:one.png']);
  complete({ entries: [{ ...resource(), dataUrl: 'data:stale' }] });
  await vi.advanceTimersByTimeAsync(0);
  expect(resourceMediaDataUrl(session, resource())).toBe('data:one.png');
});
it('separates Mod and Core physical identities', () => {
  expect(mediaResourceKey(session, resource('Graphics/ONE.png/'))).toBe(mediaResourceKey(session, resource('graphics/one.png')));
  expect(mediaResourceKey(session, { ...resource(), source: 'core' })).not.toBe(mediaResourceKey(session, resource()));
});
it('serves retained results before the cold batch interval', async () => {
  await queryResourceDataUrls(session, [resource()]);
  const held = acquireResourceMedia(session, resource());
  expect(await held.ready).toBe('data:one.png');
  held.release();
  expect(mock.load).toHaveBeenCalledOnce();
});
