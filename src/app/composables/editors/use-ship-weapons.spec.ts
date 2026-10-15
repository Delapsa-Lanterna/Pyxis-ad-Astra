import { defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JointEditRoot, ResourceRef, RowData } from '@/shared/types';
import type { ShipWeaponSources } from '@/domain/editors/ship-weapons';
import type { QueryCacheInvalidationEvent } from '@/services/query-cache.service';
import { useShipWeapons } from './use-ship-weapons';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  replaceCollection: vi.fn(),
  clear: vi.fn(),
  listener: null as ((event: QueryCacheInvalidationEvent) => void) | null,
}));
vi.mock('@/services/editor.service', () => ({ queryShipWeaponSources: mocks.query }));
vi.mock('@/services/query-cache.service', () => ({
  hasQueryInvalidation: () => true,
  subscribeQueryInvalidations: (listener: typeof mocks.listener) => {
    mocks.listener = listener;
    return () => {
      mocks.listener = null;
    };
  },
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
vi.mock('@/app/composables/use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({
    replaceCollection: mocks.replaceCollection,
    dataUrl: (_session: string, resource: ResourceRef) => resource.relPath,
    clear: mocks.clear,
  }),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.listener = null;
});

function source(id: string): ShipWeaponSources {
  return {
    baseVersions: [],
    hints: [],
    diagnostic: '',
    weapons: {
      [id]: {
        spec: { specClass: 'projectile', size: 'SMALL' },
        projectile: {},
        projectileResources: {},
        diagnostic: '',
        resources: { turretSprite: { source: 'mod', relPath: id + '.png', ownerKind: 'weapon', ownerId: id, key: 'turretSprite' } },
      },
    },
  };
}
function harness() {
  const created: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> = [];
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        created.push(this);
      }
    },
  );
  const root = ref<JointEditRoot>({ sessionId: 's', modRoot: 'M:/mod', kind: 'ship', id: 'ship' });
  const ship = ref<RowData>({
    builtInWeapons: { A: 'first' },
    weaponSlots: [{ id: 'A', type: 'BALLISTIC', mount: 'TURRET', locations: [0, 0] }],
  });
  const changed = vi.fn();
  let runtime!: ReturnType<typeof useShipWeapons>;
  const wrapper = mount(
    defineComponent({
      setup() {
        runtime = useShipWeapons(
          () => root.value,
          () => ship.value,
          changed,
        );
        return () => h('div');
      },
    }),
  );
  return { wrapper, root, ship, created, runtime, changed };
}

describe('ship built-in read and image lifecycle', () => {
  it('keeps decoded resources during geometry edits and replaces equipment on draft and history changes', async () => {
    mocks.query.mockImplementation(async (_root: JointEditRoot, ship: RowData) => source(String((ship.builtInWeapons as RowData).A)));
    const own = harness();
    await flushPromises();
    own.created[0]!.onload!();
    await flushPromises();
    const first = own.runtime.weapons.value[0]!.layers[0]!.resource;
    expect(own.runtime.image(first)).toBe(own.created[0]);
    (own.ship.value.weaponSlots as RowData[])[0]!.locations = [100, 0];
    (own.ship.value.weaponSlots as RowData[])[0]!.angle = 45;
    await flushPromises();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(own.created).toHaveLength(1);
    expect(own.runtime.weapons.value[0]!.slot.angle).toBe(45);
    own.ship.value = { ...own.ship.value, weaponSlots: [{ ...(own.ship.value.weaponSlots as RowData[])[0]!, locations: [0, 0] }] };
    await flushPromises();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(own.created).toHaveLength(1);
    own.ship.value.builtInWeapons = { A: 'second' };
    await flushPromises();
    expect(own.runtime.weapons.value[0]!.weaponId).toBe('second');
    expect(own.runtime.image(first)).toBeUndefined();
    own.ship.value.builtInWeapons = { A: 'first' };
    await flushPromises();
    expect(own.runtime.weapons.value[0]!.weaponId).toBe('first');
    expect(mocks.query).toHaveBeenCalledTimes(3);
    own.wrapper.unmount();
  });
  it('rejects late source and decode results after target replacement and unmount', async () => {
    let resolveFirst!: (value: ShipWeaponSources) => void;
    mocks.query
      .mockImplementationOnce(
        () =>
          new Promise<ShipWeaponSources>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(source('second'));
    const own = harness();
    own.root.value = { ...own.root.value, id: 'other' };
    own.ship.value.builtInWeapons = { A: 'second' };
    await flushPromises();
    resolveFirst(source('first'));
    await flushPromises();
    expect(own.runtime.weapons.value[0]!.weaponId).toBe('second');
    const resource = own.runtime.weapons.value[0]!.layers[0]!.resource;
    const lateDecode = own.created[0]!.onload!;
    own.wrapper.unmount();
    expect(own.created[0]!.onload).toBeNull();
    expect(own.created[0]!.onerror).toBeNull();
    lateDecode();
    expect(own.runtime.image(resource)).toBeUndefined();
  });
  it('refreshes related queries, reports concrete decoding failures and releases on session invalidation', async () => {
    mocks.query.mockResolvedValue(source('first'));
    const own = harness();
    await flushPromises();
    own.created[0]!.onerror!();
    await flushPromises();
    expect(own.runtime.diagnostics.value).toContain('槽位 A · 武器 first：first.png 贴图解码失败');
    mocks.listener!({ sessionId: 's', scope: 'paths', queries: [], invalidation: null });
    await flushPromises();
    expect(mocks.query).toHaveBeenCalledTimes(2);
    own.created.at(-1)!.onload!();
    await flushPromises();
    expect(own.runtime.diagnostics.value).toEqual([]);
    mocks.listener!({ sessionId: 's', scope: 'session', queries: [], invalidation: null });
    await flushPromises();
    expect(own.runtime.weapons.value).toEqual([]);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    own.wrapper.unmount();
  });
});
