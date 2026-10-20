import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useResourceMediaRegistry } from './use-resource-media-registry';
import { invalidateResourceMediaForSession, invalidateResourceMediaByProject, resourceMediaStats } from '@/services/resource-media.service';
import type { ResourceRef, ProjectInvalidation } from '@/shared/types';
const mock = vi.hoisted(() => ({
  load: vi.fn(async (resources: ResourceRef[]) => ({
    entries: resources.map((resource) => ({ ...resource, dataUrl: 'data:' + resource.relPath })),
  })),
  error: vi.fn(),
  failures: vi.fn(),
}));
vi.mock('@/shared/runtime/command.runtime', () => ({
  invokeCommand: (_command: string, { payload }: { payload: { resources: ResourceRef[] } }) => mock.load(payload.resources),
}));
vi.mock('@/shared/runtime/performance', () => ({ recordPerformance: vi.fn() }));
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
beforeEach(() => vi.useFakeTimers());
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
