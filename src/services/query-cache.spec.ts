import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createCachedSessionQuery,
  createLiveSessionQuery,
  invalidateQueryCacheByProject,
  invalidateQueryCacheForSession,
} from './query-cache.service';
import { markProjectionPending, markProjectionReady } from './project-projection.service';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { createSettingsFixture } from '@/test/settings';
import type { DeepReadonly, ProjectInvalidation } from '@/shared/types';
import { installPerformanceMonitor, type PerformanceSample } from '@/shared/runtime/performance';
import { appLogQueue } from '@/shared/runtime/app-log-queue';
import type { AppLogEntry } from '@/shared/types';

const changed: ProjectInvalidation = { paths: ['changed'], tables: [], entities: [], resources: [], queryScopes: [], session: false };
const createReader = (load: () => Promise<Array<{ name: string }>>) =>
  createCachedSessionQuery<{ id: string }, Array<{ name: string }>>({ queryKind: 'entity-list', load, invalidates: () => true });

describe('session query ownership', () => {
  it('logs query loading, sharing, cache hits and invalidation without request or response bodies', async () => {
    const records: AppLogEntry[] = [];
    appLogQueue.install(async (entries) => {
      records.push(...entries);
    }, vi.fn());
    appLogQueue.setLevel('debug');
    let finish!: (value: Array<{ name: string }>) => void;
    const read = createReader(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      const first = read('debug-query', { id: 'private request' });
      const second = read('debug-query', { id: 'private request' });
      finish([{ name: 'private response' }]);
      await Promise.all([first, second]);
      await read('debug-query', { id: 'private request' });
      const pending = read('debug-query', { id: 'other private request' });
      const ended = expect(pending).rejects.toMatchObject({ code: 'query.invalidated' });
      invalidateQueryCacheForSession('debug-query');
      await ended;
      finish([]);
      await appLogQueue.flush();
      expect(records.filter((entry) => entry.code === 'query.completed').map((entry) => entry.fields?.cache)).toEqual([
        'load',
        'shared',
        'hit',
      ]);
      expect(records.some((entry) => entry.code === 'query.invalidated')).toBe(true);
      expect(records.some((entry) => entry.code === 'query.late_result')).toBe(true);
      expect(JSON.stringify(records)).not.toContain('private');
    } finally {
      appLogQueue.setLevel('info');
      invalidateQueryCacheForSession('debug-query');
    }
  });
  it('automatically records loading, sharing, cache hits, failures and invalidation', async () => {
    const samples: PerformanceSample[] = [];
    const stop = installPerformanceMonitor((sample) => samples.push(sample));
    let finish!: (value: []) => void;
    const read = createReader(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        }),
    );
    try {
      const first = read('monitored-query', { id: 'a' });
      const shared = read('monitored-query', { id: 'a' });
      finish([]);
      await Promise.all([first, shared]);
      await read('monitored-query', { id: 'a' });
      const cancelled = read('monitored-query', { id: 'b' });
      const ended = expect(cancelled).rejects.toMatchObject({ code: 'query.invalidated' });
      invalidateQueryCacheForSession('monitored-query');
      await ended;
      finish([]);
      const live = createLiveSessionQuery({ queryKind: 'monitor-live', load: async () => [], invalidates: () => true });
      await live('monitored-query', {});
      const failure = createReader(async () => {
        throw new Error('read failure');
      });
      await expect(failure('monitored-query', { id: 'a' })).rejects.toThrow('read failure');
      expect(samples.map((sample) => [sample.category, sample.name, sample.fields.cache, sample.fields.status])).toEqual([
        ['query', 'entity-list', 'load', 'ok'],
        ['query', 'entity-list', 'shared', 'ok'],
        ['query', 'entity-list', 'hit', 'ok'],
        ['query', 'entity-list', 'load', 'invalidated'],
        ['query', 'monitor-live', 'live', 'ok'],
        ['query', 'entity-list', 'load', 'error'],
      ]);
      expect(samples.every((sample) => sample.duration >= 0)).toBe(true);
    } finally {
      stop();
      invalidateQueryCacheForSession('monitored-query');
    }
  });
  it('fixes parameters and the read-only result at the query definition', async () => {
    const read = createReader(async () => [{ name: 'Original' }]);
    expectTypeOf(read).parameter(1).toEqualTypeOf<{ id: string }>();
    expectTypeOf<Awaited<ReturnType<typeof read>>>().toEqualTypeOf<DeepReadonly<Array<{ name: string }>>>();
    expect(await read('typed-query', { id: 'a' })).toEqual([{ name: 'Original' }]);
    invalidateQueryCacheForSession('typed-query');
  });
  it('ends an already released consumer before loading', async () => {
    const controller = new AbortController();
    controller.abort();
    const load = vi.fn(async () => []);
    await expect(createReader(load)('aborted-query', { id: 'a' }, controller.signal)).rejects.toMatchObject({ code: 'query.invalidated' });
    expect(load).not.toHaveBeenCalled();
  });
  it('shares a pending request while cancellation ends only the consumer wait', async () => {
    let finish!: (value: []) => void;
    const load = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        }),
    );
    const read = createReader(load),
      controller = new AbortController();
    const first = read('shared-query', { id: 'a' }, controller.signal);
    const second = read('shared-query', { id: 'a' });
    const ended = expect(first).rejects.toMatchObject({ code: 'query.invalidated', cause: { reason: 'consumer' } });
    controller.abort();
    await ended;
    finish([]);
    await expect(second).resolves.toEqual([]);
    await read('shared-query', { id: 'a' });
    expect(load).toHaveBeenCalledOnce();
    invalidateQueryCacheForSession('shared-query');
  });
  it('retries failures and isolates sessions', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('read failure')).mockResolvedValue([]);
    const read = createReader(load);
    await expect(read('failed-query', { id: 'a' })).rejects.toThrow('read failure');
    await read('failed-query', { id: 'a' });
    await read('other-query', { id: 'a' });
    expect(load).toHaveBeenCalledTimes(3);
    invalidateQueryCacheForSession('failed-query');
    invalidateQueryCacheForSession('other-query');
  });
  it.each(['success', 'error'] as const)('keeps replacement data after an invalidated late %s', async (outcome) => {
    let finish!: (value: []) => void, fail!: (error: Error) => void;
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<[]>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
      )
      .mockResolvedValue([{ name: 'Current' }]);
    const read = createReader(load);
    const old = read('late-query', { id: 'a' });
    const ended = expect(old).rejects.toMatchObject({ code: 'query.invalidated' });
    invalidateQueryCacheByProject('late-query', changed);
    await ended;
    await read('late-query', { id: 'a' });
    if (outcome === 'success') finish([]);
    else fail(new Error('late failure'));
    expect(await read('late-query', { id: 'a' })).toEqual([{ name: 'Current' }]);
    expect(load).toHaveBeenCalledTimes(2);
    invalidateQueryCacheForSession('late-query');
  });
  it('gates cached values and pending completion with the projection state', async () => {
    const read = createReader(async () => []);
    await read('projection-gated', { id: 'a' });
    markProjectionPending('projection-gated', 3);
    await expect(read('projection-gated', { id: 'a' })).rejects.toMatchObject({ code: 'session.projection_pending' });
    markProjectionReady('projection-gated', 2);
    await expect(read('projection-gated', { id: 'a' })).rejects.toMatchObject({ code: 'session.projection_pending' });
    markProjectionReady('projection-gated', 3);
    await expect(read('projection-gated', { id: 'a' })).resolves.toEqual([]);
    invalidateQueryCacheForSession('projection-gated');
    let finish!: (value: []) => void;
    const pending = createReader(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        }),
    )('projection-gated', { id: 'b' });
    markProjectionPending('projection-gated', 4);
    finish([]);
    await expect(pending).rejects.toMatchObject({ code: 'session.projection_pending' });
    markProjectionReady('projection-gated', 4);
    invalidateQueryCacheForSession('projection-gated');
  });
  it('ends pending requests for a closed session and allows a fresh read', async () => {
    let finish!: (value: []) => void;
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<[]>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue([]);
    const read = createReader(load),
      old = read('closed-query', { id: 'a' });
    const ended = expect(old).rejects.toMatchObject({ code: 'query.invalidated', cause: { reason: 'session' } });
    invalidateQueryCacheForSession('closed-query');
    await ended;
    finish([]);
    await read('closed-query', { id: 'a' });
    expect(load).toHaveBeenCalledTimes(2);
    invalidateQueryCacheForSession('closed-query');
  });
  it('preserves single-flight with zero retained capacity', async () => {
    const limits = createSettingsFixture().cacheLimits;
    limits.queries['entity-list'] = 0;
    initializeCacheLimits(limits);
    try {
      let finish!: (value: []) => void;
      const load = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<[]>((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValue([]);
      const read = createReader(load);
      const first = read('zero-query', { id: 'a' }),
        second = read('zero-query', { id: 'a' });
      expect(load).toHaveBeenCalledOnce();
      finish([]);
      await Promise.all([first, second]);
      limits.queries['entity-list'] = 1;
      initializeCacheLimits(limits);
      await read('zero-query', { id: 'cached' });
      limits.queries['entity-list'] = 0;
      initializeCacheLimits(limits);
      await read('zero-query', { id: 'cached' });
      await read('zero-query', { id: 'a' });
      expect(load).toHaveBeenCalledTimes(4);
      invalidateQueryCacheForSession('zero-query');
    } finally {
      initializeCacheLimits(createSettingsFixture().cacheLimits);
    }
  });
  it.each(['cached', 'live'] as const)('captures %s parameters once for loading and invalidation', async (mode) => {
    let reads = 0,
      finish!: (value: []) => void;
    const input = {
      get path() {
        reads++;
        return 'original';
      },
    };
    const load = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        }),
    );
    const invalidates = vi.fn((parameters: { path: string }) => parameters.path === 'original');
    const definition = { queryKind: 'entity-list' as const, load, invalidates };
    const read = mode === 'cached' ? createCachedSessionQuery(definition) : createLiveSessionQuery(definition);
    const pending = read('snapshot-query', input);
    expect(reads).toBe(1);
    expect(load).toHaveBeenCalledWith({ sessionId: 'snapshot-query', queryKind: 'entity-list', parameters: { path: 'original' } });
    const ended = expect(pending).rejects.toMatchObject({ code: 'query.invalidated' });
    invalidateQueryCacheByProject('snapshot-query', changed);
    await ended;
    expect(invalidates).toHaveBeenCalledWith({ path: 'original' }, changed);
    finish([]);
    invalidateQueryCacheForSession('snapshot-query');
  });
});
