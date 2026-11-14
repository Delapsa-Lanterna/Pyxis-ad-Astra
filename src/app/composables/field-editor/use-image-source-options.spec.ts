import { projectChangeFixture, closeProjectChangeFixture } from '@/test/unit/project-changes';
import { savedWriteFixture } from '@/test/fixtures/write-result';
vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({ ...(await import('@/test/unit/project-changes')) }));
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageSourceOptions } from './use-image-source-options';
import type { SourceOptionGroup } from '@/shared/types';
import type * as SourceCatalogService from '@/services/source-catalog.service';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/services/source-catalog.service', async (original) => ({
  ...(await original<typeof SourceCatalogService>()),
  queryImageSourceOptions: mocks.query,
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
const groups: SourceOptionGroup[] = [
  { origin: 'mod', options: [{ label: 'Image', value: 'graphics/sample.png', origin: 'mod', description: null, resourceRef: null }] },
];
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue(groups);
});
afterEach(() => wrapper?.unmount());
function harness() {
  const active = ref(false),
    directories = ref<string[] | undefined>(['graphics/icons']),
    sessionId = ref('one'),
    missionId = ref<string>();
  let options!: ReturnType<typeof useImageSourceOptions>;
  wrapper = mount({
    setup() {
      options = useImageSourceOptions({
        active: () => active.value,
        directories: () => directories.value,
        sessionId: () => sessionId.value,
        missionId: () => missionId.value,
      });
      return () => null;
    },
  });
  return { active, directories, sessionId, missionId, options };
}
describe('image directory candidate lifecycle', () => {
  it('refreshes only image directories, their parents and the captured mission', async () => {
    const state = harness();
    state.active.value = true;
    await flushPromises();
    for (const relPath of ['data/hulls/sample.ship', 'graphics/other/sample.png', 'graphics/icons2/sample.png']) {
      const invalidation = savedWriteFixture().invalidation;
      invalidation.session = false;
      invalidation.resources = [{ source: 'mod', relPath }];
      await projectChangeFixture('one', invalidation);
    }
    expect(mocks.query).toHaveBeenCalledTimes(1);
    for (const relPath of ['graphics/icons/sample.png', 'graphics']) {
      const invalidation = savedWriteFixture().invalidation;
      invalidation.session = false;
      invalidation.resources = [{ source: 'core', relPath }];
      await projectChangeFixture('one', invalidation);
    }
    expect(mocks.query).toHaveBeenCalledTimes(3);
    state.missionId.value = 'sample';
    state.directories.value = ['.'];
    await flushPromises();
    const invalidation = savedWriteFixture().invalidation;
    invalidation.resources = [{ source: 'mod', relPath: 'data/missions/other/icon.png' }];
    await projectChangeFixture('one', invalidation);
    expect(mocks.query).toHaveBeenCalledTimes(4);
    invalidation.resources = [{ source: 'mod', relPath: 'data/missions/sample/icon.png' }];
    await projectChangeFixture('one', invalidation);
    expect(mocks.query).toHaveBeenCalledTimes(5);
  });
  it('loads on opening, clears absent ranges and reloads the captured mission and directories', async () => {
    const state = harness();
    expect(mocks.query).not.toHaveBeenCalled();
    state.active.value = true;
    await flushPromises();
    expect(state.options.value[0]?.children?.[0]?.value).toBe('graphics/sample.png');
    state.missionId.value = 'sample';
    state.directories.value = ['.'];
    await flushPromises();
    expect(mocks.query).toHaveBeenLastCalledWith('one', ['.'], 'sample', expect.any(AbortSignal));
    for (const directories of [[], undefined]) {
      state.directories.value = directories;
      await flushPromises();
      expect(state.options.value).toEqual([]);
    }
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
  it('reports read errors once and retries after a directory refresh', async () => {
    mocks.query.mockRejectedValueOnce(new Error('directory denied'));
    const state = harness();
    state.active.value = true;
    await flushPromises();
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(state.options.value).toEqual([]);
    const invalidation = savedWriteFixture().invalidation;
    invalidation.resources = [{ source: 'mod', relPath: 'graphics/icons' }];
    void projectChangeFixture('one', invalidation);
    await flushPromises();
    expect(state.options.value[0]?.children).toHaveLength(1);
    closeProjectChangeFixture('one');
    await flushPromises();
    expect(state.options.value).toEqual([]);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
  it.each(['directory', 'mission', 'session', 'close', 'unmount'])('rejects late results after %s', async (reason) => {
    let finish!: (value: SourceOptionGroup[]) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise<SourceOptionGroup[]>((resolve) => {
          finish = resolve;
        }),
    );
    const state = harness();
    state.active.value = true;
    await flushPromises();
    const signal = mocks.query.mock.calls[0]![3] as AbortSignal;
    if (reason === 'directory') state.directories.value = [];
    if (reason === 'mission') state.missionId.value = 'next';
    if (reason === 'session') state.sessionId.value = 'two';
    if (reason === 'close') state.active.value = false;
    if (reason === 'unmount') wrapper.unmount();
    await flushPromises();
    const current = state.options.value;
    finish(groups);
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(state.options.value).toEqual(current);
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
