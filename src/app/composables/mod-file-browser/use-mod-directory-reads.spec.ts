import { describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createModDirectoryReads } from './use-mod-directory-reads';
import type { ModDirectory } from '@/shared/types';

function setup() {
  const pending: Array<{ directory: string | null; resolve: (value: ModDirectory) => void; reject: (error: Error) => void }> = [];
  const load = vi.fn(
    ({ directory }: { sessionId: string; directory: string | null }) =>
      new Promise<ModDirectory>((resolve, reject) => {
        pending.push({ directory, resolve, reject });
      }),
  );
  const ready = vi.fn(),
    error = vi.fn(),
    settled = vi.fn();
  const reads = createModDirectoryReads({ load, started: vi.fn(), ready, error, settled });
  const request = (directory: string, priority: 'foreground' | 'prefetch' = 'foreground', sessionId = 's1') =>
    reads.request({ sessionId, directory }, priority);
  const complete = async (directory: string) => {
    pending.find((task) => task.directory === directory)!.resolve({ directory, entries: [] });
    await flushPromises();
  };
  return { reads, request, complete, pending, load, ready, error, settled };
}

describe('directory read scheduling', () => {
  it('limits preloads to two and reserves capacity for clicked directories', async () => {
    const { request, load, complete } = setup();
    void request('a', 'prefetch');
    void request('b', 'prefetch');
    void request('c', 'prefetch');
    expect(load.mock.calls.map(([identity]) => identity.directory)).toEqual(['a', 'b']);
    void request('clicked');
    expect(load.mock.calls.map(([identity]) => identity.directory)).toEqual(['a', 'b', 'clicked']);
    await complete('a');
    expect(load.mock.calls.map(([identity]) => identity.directory)).toEqual(['a', 'b', 'clicked', 'c']);
  });
  it('promotes a queued preload ahead of background work and shares queued and active requests', async () => {
    const { request, load, complete, ready } = setup();
    void request('a', 'prefetch');
    void request('b', 'prefetch');
    void request('earlier', 'prefetch');
    const preloaded = request('clicked', 'prefetch');
    const clicked = request('clicked');
    expect(clicked).toBe(preloaded);
    expect(load.mock.calls.map(([identity]) => identity.directory)).toEqual(['a', 'b', 'clicked']);
    expect(request('clicked')).toBe(clicked);
    await complete('clicked');
    expect(await clicked).toBe(true);
    expect(ready).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(3);
    await complete('a');
    expect(load.mock.calls.at(-1)![0].directory).toBe('earlier');
  });
  it('keeps physical slots occupied until invalidated IPCs actually finish', async () => {
    const { reads, request, load, complete, ready, error } = setup();
    const first = request('a', 'prefetch');
    void request('b', 'prefetch');
    void request('clicked');
    const queued = request('queued', 'prefetch');
    reads.revoke();
    expect(await first).toBe(false);
    expect(await queued).toBe(false);
    const replacement = request('replacement');
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(3);
    await complete('a');
    expect(load.mock.calls.at(-1)![0].directory).toBe('replacement');
    expect(ready).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await complete('replacement');
    expect(await replacement).toBe(true);
    expect(ready).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1', directory: 'replacement' }, { directory: 'replacement', entries: [] });
  });
  it('isolates session identities and allows fresh reads after a real failure', async () => {
    const { request, load, pending, complete, error } = setup();
    const first = request('data');
    void request('data', 'foreground', 's2');
    expect(load).toHaveBeenCalledTimes(2);
    const failure = new Error('disk error');
    pending[0]!.reject(failure);
    expect(await first).toBe(false);
    expect(error).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1', directory: 'data' }, failure);
    const retry = request('retry');
    await complete('retry');
    expect(await retry).toBe(true);
  });
  it('revokes a deleted subtree while retaining unrelated work and consumes late errors', async () => {
    const { reads, request, pending, ready, error, complete } = setup();
    const old = request('data/nested');
    const sibling = request('other');
    reads.revoke(({ directory }) => directory!.startsWith('data/'));
    expect(await old).toBe(false);
    pending[0]!.reject(new Error('late disk error'));
    await complete('other');
    expect(await sibling).toBe(true);
    expect(ready).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });
});
