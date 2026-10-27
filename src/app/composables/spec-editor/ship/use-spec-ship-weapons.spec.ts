import { projectChangeFixture, closeProjectChangeFixture } from '@/test/unit/project-changes';
import { savedWriteFixture } from '@/test/fixtures/write-result';
vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({ ...(await import('@/test/unit/project-changes')) }));
import { defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JointEditRoot, ResourceRef, RowData } from '@/shared/types/index';
import type { ShipWeaponSources } from '@/domain/spec-editor/ship/spec-ship-weapons';
import { useSpecShipWeapons } from './use-spec-ship-weapons';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  replaceCollection: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/services/spec-ship-editor.service', () => ({ querySpecShipWeaponSources: mocks.query }));
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
  let runtime!: ReturnType<typeof useSpecShipWeapons>;
  const wrapper = mount(
    defineComponent({
      setup() {
        runtime = useSpecShipWeapons(
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
    projectChangeFixture('s', { ...savedWriteFixture().invalidation, paths: ['weapons'] });
    await flushPromises();
    expect(mocks.query).toHaveBeenCalledTimes(2);
    own.created.at(-1)!.onload!();
    await flushPromises();
    expect(own.runtime.diagnostics.value).toEqual([]);
    closeProjectChangeFixture('s');
    await flushPromises();
    expect(own.runtime.weapons.value).toEqual([]);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    own.wrapper.unmount();
  });
});
