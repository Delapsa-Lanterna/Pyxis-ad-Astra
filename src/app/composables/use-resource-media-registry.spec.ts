import { defineComponent, h } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useResourceMediaRegistry } from './use-resource-media-registry';
import { invalidateResourceMediaForSession, invalidateResourceMediaByProject, resourceMediaStats } from '@/services/resource-media.service';
import type { ResourceRef, ProjectInvalidation, ResourceDataUrlBatchResult } from '@/shared/types';
const mock = vi.hoisted(() => ({
  load: vi.fn(async (resources: ResourceRef[]): Promise<ResourceDataUrlBatchResult> => ({
    entries: resources.map((resource) => ({ ...resource, dataUrl: 'data:' + resource.relPath })),
  })),
  error: vi.fn(),
  failures: vi.fn(),
}));
vi.mock('@/shared/runtime/command.runtime', () => ({
  invokeCommand: (_command: string, { payload }: { payload: { resources: ResourceRef[] } }) => mock.load(payload.resources),
}));
const resource = (id: number): ResourceRef => ({
  source: 'mod',
  relPath: id + '.png',
  ownerKind: 'ship',
  ownerId: String(id),
  key: 'sprite',
});
function harness() {
  let registry!: ReturnType<typeof useResourceMediaRegistry>;
  const wrapper = mount(
    defineComponent({
      setup() {
        registry = useResourceMediaRegistry({ onError: mock.error, onFailures: mock.failures });
        return () => h('div');
      },
    }),
  );
  return { registry, wrapper };
}
async function settle(task: Promise<void>) {
  await vi.advanceTimersByTimeAsync(25);
  await task;
}
enableAutoUnmount(afterEach);
beforeEach(() => vi.useFakeTimers());
it('includes a successful Mod image when reporting an original image failure', async () => {
  const { registry, wrapper } = harness();
  const core = { ...resource(1), source: 'core' as const },
    local = resource(2);
  mock.load.mockResolvedValueOnce({
    entries: [
      {
        ...core,
        dataUrl: null,
        error: {
          code: 'io.unexpected',
          message: 'fixture failure',
          location: { path: 'G:/fixture/starsector-core/1.png', line: null, column: null },
        },
      },
      { ...local, dataUrl: 'data:fixture', resolvedPath: 'M:/successful-mod/2.png' },
    ],
  });
  await settle(registry.replaceCollection('registry', 'fixture', [core, local]));
  expect(mock.error).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ failures: [expect.objectContaining({ message: 'fixture failure' })] }),
    { paths: ['M:/successful-mod/2.png'] },
  );
  expect(registry.dataUrl('registry', local)).toBe('data:fixture');
  expect(mock.load).toHaveBeenCalledOnce();
  wrapper.unmount();
});
afterEach(() => {
  invalidateResourceMediaForSession('registry');
  vi.useRealTimers();
});
it('reads 1000 collections as one batch and replaces one independently', async () => {
  const { registry, wrapper } = harness();
  await settle(
    registry.replaceCollections(
      'registry',
      Array.from({ length: 1000 }, (_, id) => ({ id: 'row:' + id, resources: [resource(id)] })),
    ),
  );
  expect(mock.load).toHaveBeenCalledOnce();
  expect(mock.load.mock.calls[0]![0]).toHaveLength(1000);
  await settle(registry.replaceCollection('registry', 'row:500', [resource(1001)]));
  expect(registry.dataUrl('registry', resource(499))).toBe('data:499.png');
  expect(registry.dataUrl('registry', resource(1001))).toBe('data:1001.png');
  expect(resourceMediaStats().activeEntries).toBe(1000);
  wrapper.unmount();
  expect(resourceMediaStats().activeEntries).toBe(0);
});
it('keeps selected content while independent menus release shared references', async () => {
  const { registry, wrapper } = harness();
  await settle(registry.replaceCollection('registry', 'selected', [resource(1)]));
  await settle(registry.replaceCollection('registry', 'menu', [resource(1), resource(2)]));
  await registry.releaseCollection('menu');
  expect(resourceMediaStats().activeEntries).toBe(1);
  expect(registry.dataUrl('registry', resource(1))).toBe('data:1.png');
  wrapper.unmount();
});
it('dispatches an immediate collection without advancing the cold batch timer', async () => {
  const { registry, wrapper } = harness();
  await registry.replaceCollection('registry', 'preview', [resource(1), resource(2)], true);
  expect(mock.load).toHaveBeenCalledOnce();
  expect(mock.load.mock.calls[0]![0]).toEqual([resource(1), resource(2)]);
  expect(registry.dataUrl('registry', resource(2))).toBe('data:2.png');
  wrapper.unmount();
  expect(resourceMediaStats().activeEntries).toBe(0);
});
it('retries an explicit collection after transport failure', async () => {
  const { registry, wrapper } = harness();
  mock.load.mockRejectedValueOnce(new Error('transport'));
  await settle(registry.replaceCollection('registry', 'selected', [resource(1)]));
  expect(mock.error).toHaveBeenCalledOnce();
  await settle(registry.replaceCollection('registry', 'menu', [resource(1)]));
  expect(registry.dataUrl('registry', resource(1))).toBe('data:1.png');
  wrapper.unmount();
});
it('suppresses late errors after release and reloads invalidated active resources', async () => {
  const { registry, wrapper } = harness();
  await settle(registry.replaceCollection('registry', 'selected', [resource(1)]));
  invalidateResourceMediaByProject('registry', { session: false, resources: [{ source: 'mod', relPath: '1.png' }] } as ProjectInvalidation);
  await vi.advanceTimersByTimeAsync(25);
  expect(mock.load).toHaveBeenCalledTimes(2);
  invalidateResourceMediaForSession('registry');
  expect(resourceMediaStats().activeEntries).toBe(0);
  wrapper.unmount();
});
