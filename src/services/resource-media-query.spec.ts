import { describe, expect, it, vi } from 'vitest';
import type { ResourceDataUrlBatchEntry, ResourceDataUrlBatchResult, ResourceRef } from '@/shared/types';
import * as resourceMediaService from '@/services/resource-media.service';
import { mediaIdleByteLimit } from '@/services/resource-media.service';

const { queryResourceDataUrls: queryResources } = resourceMediaService;
const { mediaIdleEntryLimit } = resourceMediaService;

const mocks = vi.hoisted(() => ({
  queryBatch: vi.fn(async (first: string | ResourceRef[], second?: ResourceRef[]): Promise<ResourceDataUrlBatchResult> => ({
    entries: (second ?? (Array.isArray(first) ? first : [])).map(
      (resource) =>
        ({
          key: resource.key,
          source: resource.source,
          relPath: resource.relPath,
          ['owner' + 'Kind']: resource.ownerKind,
          ['owner' + 'Id']: resource.ownerId,
          dataUrl: `data:${resource.relPath}`,
        }) as unknown as ResourceDataUrlBatchEntry,
    ),
  })),
}));

vi.mock('@/shared/runtime/command.runtime', () => ({
  invokeCommand: (_command: string, args: { payload: { sessionId: string; resources: ResourceRef[] } }) =>
    mocks.queryBatch(args.payload.sessionId, args.payload.resources),
}));

describe('resource media query', () => {
  it('delivers nine successes, shares one batch failure and retries its failed resources', async () => {
    const resources = Array.from({ length: 10 }, (_, index) => resource(1200 + index));
    mocks.queryBatch.mockResolvedValueOnce({
      entries: resources.map((item, index) => ({
        ...item,
        dataUrl: index === 9 ? null : 'data:' + item.relPath,
        ...(index === 9 ? { error: { code: 'reference.unavailable', message: 'fixture source closed', location: null } } : {}),
      })),
    });
    const leases = resources.map((item) => resourceMediaService.acquireResourceMedia('partial-batch', item));
    const duplicate = resourceMediaService.acquireResourceMedia('partial-batch', resources[9]!);
    const settled = await Promise.allSettled([...leases, duplicate].map((lease) => lease.ready));
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(9);
    const failures = settled.filter((item) => item.status === 'rejected');
    expect(failures).toHaveLength(2);
    expect(failures[0]!.reason).toBe(failures[1]!.reason);
    expect(failures[0]!.reason.failures).toEqual([{ code: 'reference.unavailable', message: 'fixture source closed', location: null }]);
    [...leases, duplicate].forEach((lease) => lease.release());
    expect(await queryResources('partial-batch', resources)).toHaveLength(10);
  });
  it('validates the whole batch before caching any result', async () => {
    const first = resource(950),
      second = resource(951);
    mocks.queryBatch.mockResolvedValueOnce({
      entries: [
        { ...first, dataUrl: 'data:bad-batch' },
        { ...second, ownerId: 'wrong', dataUrl: null },
      ],
    });
    await expect(queryResources('atomic-resource', [first, second])).rejects.toMatchObject({ action: 'query-resource-data-urls' });
    expect(await queryResources('atomic-resource', [first])).toEqual(['data:graphics/test/950.png']);
    expect(mocks.queryBatch).toHaveBeenCalledTimes(2);
  });

  it('returns oversized content and leaves ordinary cached content retained', async () => {
    const first = resource(952),
      second = resource(953);
    await queryResources('oversized-resource', [first]);
    const oversized = 'x'.repeat(mediaIdleByteLimit() + 1);
    mocks.queryBatch.mockResolvedValueOnce({ entries: [{ ...second, dataUrl: oversized }] });
    expect((await queryResources('oversized-resource', [second]))[0]).toBe(oversized);
    expect(await queryResources('oversized-resource', [first])).toEqual(['data:graphics/test/952.png']);
    expect(await queryResources('oversized-resource', [second])).toEqual(['data:graphics/test/953.png']);
    expect(mocks.queryBatch).toHaveBeenCalledTimes(3);
  });
  it('retains the configured idle resources and refreshes LRU order on access', async () => {
    const sessionId = 'resource-cache-lru';
    const initial = Array.from({ length: mediaIdleEntryLimit() }, (_, index) => resource(index));
    await queryResources(sessionId, initial);
    await queryResources(sessionId, [initial[0]!]);
    await queryResources(sessionId, [resource(mediaIdleEntryLimit())]);
    await queryResources(sessionId, [initial[1]!]);
    await queryResources(sessionId, [initial[0]!]);

    expect(mocks.queryBatch.mock.calls.map((call) => call[1]?.length)).toEqual([mediaIdleEntryLimit(), 1, 1]);
  });

  it('shares a cached data URL across owner metadata for one physical path', async () => {
    const sessionId = 'resource-cache-physical-key';
    const first = resource(900);
    const second: ResourceRef = { ...first, ownerId: 'other-owner', key: 'thumbnail' };
    await queryResources(sessionId, [first]);
    const result = await queryResources(sessionId, [second]);

    expect(result).toEqual(['data:graphics/test/900.png']);
    expect(mocks.queryBatch).toHaveBeenCalledTimes(1);
  });

  it('keeps a replacement request when an invalidated request arrives late', async () => {
    const sessionId = 'resource-cache-late';
    const target = resource(901);
    let resolveOld!: (result: ResourceDataUrlBatchResult) => void;
    mocks.queryBatch.mockReturnValueOnce(
      new Promise<ResourceDataUrlBatchResult>((resolve) => {
        resolveOld = resolve;
      }),
    );
    const old = queryResources(sessionId, [target]);
    const ended = expect(old).rejects.toMatchObject({ code: 'query.invalidated' });
    resourceMediaService.invalidateResourceMediaForSession(sessionId);
    await ended;
    await queryResources(sessionId, [target]);
    resolveOld({ entries: [{ ...target, dataUrl: 'data:stale' }] });
    expect(await queryResources(sessionId, [target])).toEqual(['data:graphics/test/901.png']);
    expect(mocks.queryBatch).toHaveBeenCalledTimes(2);
  });

  it('notifies session invalidation for an empty media owner', () => {
    const listener = vi.fn();
    const unsubscribe = resourceMediaService.subscribeResourceInvalidations(listener);
    resourceMediaService.invalidateResourceMediaForSession('projection-only');
    expect(listener).toHaveBeenCalledWith({ invalidation: null, resources: [], sessionId: 'projection-only', scope: 'session' });
    unsubscribe();
  });
});

function resource(index: number): ResourceRef {
  return JSON.parse(
    `{"source":"mod","relPath":"graphics/test/${index}.png","ownerKind":"ship","ownerId":"ship-${index}","key":"sprite"}`,
  ) as ResourceRef;
}
