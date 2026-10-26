import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { jointObject } from '@/domain/joint-edit';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shipJointFixture } from '@/test/fixtures/joint-edit/ship-joint-edit';
import { weaponJointFixture } from '@/test/fixtures/joint-edit/weapon-joint-edit';
import { wingJointFixture } from '@/test/fixtures/joint-edit/wing-joint-edit';
import { variantJointFixture } from '@/test/fixtures/joint-edit/variant-joint-edit';
import { setVariantHullmod, equipVariantWing } from '@/domain/immersive/variant/variant-actions';
import type { JointEditSnapshot } from '@/shared/types';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/fixtures/write-result';
import type { EntityIdentityAppliedEvent } from '@/windows/window.events';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  save: vi.fn(),
  projection: vi.fn(),
  catalog: vi.fn(),
  candidate: vi.fn(),
  listen: vi.fn(),
  stop: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
  retarget: vi.fn(),
  media: vi.fn(),
  choose: vi.fn(),
  openProjectile: vi.fn(),
  invalidations: [] as Array<(event: unknown) => void>,
  projectUpdates: [] as Array<(event: import('@/windows/window.events').ProjectSessionInvalidatedEvent) => Promise<void>>,
}));
vi.mock('@/services/joint-edit.service', () => ({
  queryJointEdit: mocks.query,
  queryJointEditRow: mocks.query,
  queryJointEditProjection: mocks.projection,
  queryJointVariantCatalog: mocks.catalog,
  queryJointCandidate: mocks.candidate,
}));
vi.mock('@/app/composables/use-joint-edit-actions', () => ({ useJointEditActions: () => ({ open: mocks.query, save: mocks.save }) }));
vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({ error: mocks.error, success: vi.fn(), choose: mocks.choose }),
}));
vi.mock('@/orchestrators/project-sync.orchestrator', () => ({
  listenEntityIdentityApplied: mocks.listen,
  listenProjectSessionInvalidated: async (
    listener: (event: import('@/windows/window.events').ProjectSessionInvalidatedEvent) => Promise<void>,
  ) => {
    mocks.projectUpdates.push(listener);
    return () => {
      mocks.projectUpdates.splice(mocks.projectUpdates.indexOf(listener), 1);
    };
  },
  completeSavedWrite: async () => {},
}));

vi.mock('@/orchestrators/immersive-editor.orchestrator', () => ({ retargetImmersiveWindow: mocks.retarget }));
vi.mock('@/windows/spec-editor.window', () => ({ openSpecProjectileEditorWindow: mocks.openProjectile }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: mocks.log }));
vi.mock('@/services/source-options.service', () => ({ querySourceOptionCatalog: vi.fn(), hasSourceInvalidation: () => false }));
vi.mock('@/services/query-cache.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/query-cache.service')>()),
  subscribeQueryInvalidations: (listener: (event: unknown) => void) => {
    mocks.invalidations.push(listener);
    return () => {
      mocks.invalidations.splice(mocks.invalidations.indexOf(listener), 1);
    };
  },
}));
vi.mock('@/app/composables/use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({ dataUrl: () => '', replaceCollection: mocks.media }),
}));
import { useImmersiveEditorViewModel } from './immersive-editor-assembly';

function editor(kind: 'ship' | 'weapon' | 'wing' | 'variant' = 'ship') {
  let vm!: ReturnType<typeof useImmersiveEditorViewModel>;
  const wrapper = mount({
    setup() {
      vm = useImmersiveEditorViewModel(
        kind === 'ship'
          ? { ...shipJointFixture().root, kind: 'ship' }
          : kind === 'weapon'
            ? { ...weaponJointFixture().root, kind: 'weapon' }
            : kind === 'wing'
              ? { ...wingJointFixture().root, kind: 'wing', rowKey: 'wing-row' }
              : { ...variantJointFixture().root, kind: 'variant' },
      );
      return () => null;
    },
  });
  return { vm, wrapper };
}
function shipPanel(vm: ReturnType<typeof useImmersiveEditorViewModel>) {
  const panel = vm.panel.value;
  if (panel?.kind !== 'ship') throw new Error('ship panel fixture');
  return panel;
}
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ theme: 'dark', editHistoryLimit: 20, logRotationSizeMiB: 10, logBackupCount: 5 }));
  vi.clearAllMocks();
  mocks.invalidations.length = 0;
  mocks.projectUpdates.length = 0;
  mocks.query.mockResolvedValue(shipJointFixture());
  mocks.listen.mockResolvedValue(mocks.stop);
  mocks.choose.mockResolvedValue('follow');
});

describe('variant joint actions', () => {
  it('keeps an accepted graph through delayed removal and accepts new equipment in one display update', async () => {
    const baseline = variantJointFixture();
    const graph = structuredClone(baseline);
    const row = structuredClone(graph.records.find((record) => record.key === 'mod')!);
    row.key = 'expanded';
    if (row.target.kind !== 'csv') throw new Error('Hullmod fixture');
    row.target.identity.id = 'expanded';
    row.value = { state: 'present', value: { id: 'expanded', name: 'Expanded Magazines', cost_cruiser: '7' } };
    row.resourceRefs.icon = { source: 'core', relPath: 'expanded.png', ownerKind: 'hullmods', ownerId: 'expanded', key: 'icon' };
    graph.records.push(row);
    mocks.query.mockResolvedValue(baseline);
    let finish!: (value: JointEditSnapshot) => void;
    mocks.projection.mockImplementation(
      () =>
        new Promise<JointEditSnapshot>((resolve) => {
          finish = resolve;
        }),
    );
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    await flushPromises();
    expect(mocks.projection).not.toHaveBeenCalled();
    const view = () => {
      if (vm.panel.value?.kind !== 'variant') throw new Error('Variant panel fixture');
      return vm.panel.value.variants[0]!;
    };
    await vm.variant!.updateVariant('variant', (data) => setVariantHullmod(data, 'expanded', 'normal'));
    await flushPromises();
    expect(jointObject(vm.joint.draftValue.value.variant).hullMods).toContain('expanded');
    expect(view().mods.map((mod) => mod.id)).toEqual(['rangefinder']);
    expect(view().opUsed).toBe(71);
    finish(graph);
    await flushPromises();
    expect(view().mods[1]).toMatchObject({ name: 'Expanded Magazines', cost: 7, icon: row.resourceRefs.icon });
    expect(view().opUsed).toBe(78);
    await vm.variant!.updateVariant('variant', (data) => setVariantHullmod(data, 'rangefinder', null));
    await flushPromises();
    expect(view().mods.map((mod) => mod.id)).toEqual(['rangefinder', 'expanded']);
    expect(view().mods[1]!.cost).toBe(7);
    finish(graph);
    await flushPromises();
    expect(view().mods.map((mod) => mod.id)).toEqual(['expanded']);
    expect(view().opUsed).toBe(33);
    const reads = mocks.projection.mock.calls.length;
    await vm.variant!.updateVariant('variant', (data) => setVariantHullmod(data, 'expanded', 's'));
    await vm.variant!.updateVariant('variant', (data) => ({ ...data, fluxCapacitors: 5 }));
    await flushPromises();
    expect(view().mods[0]).toMatchObject({ category: 's', cost: 0 });
    expect(view().capacity).toBe(12000);
    expect(mocks.projection).toHaveBeenCalledTimes(reads);
    await vm.undo();
    expect(view().capacity).toBe(11800);
    wrapper.unmount();
  });
  it('rejects a late equipment graph after a newer draft and keeps the graph on read failure', async () => {
    const baseline = variantJointFixture();
    mocks.query.mockResolvedValue(baseline);
    let first!: (value: JointEditSnapshot) => void, second!: (value: JointEditSnapshot) => void;
    mocks.projection
      .mockImplementationOnce(
        () =>
          new Promise<JointEditSnapshot>((resolve) => {
            first = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<JointEditSnapshot>((resolve) => {
            second = resolve;
          }),
      );
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    await vm.variant!.updateVariant('variant', (data) => equipVariantWing(data, 0, 'first'));
    await flushPromises();
    await vm.variant!.updateVariant('variant', (data) => equipVariantWing(data, 0, 'second'));
    await flushPromises();
    const latest = structuredClone(baseline);
    const wing = latest.records.find((record) => record.key === 'wing')!;
    if (wing.target.kind !== 'csv') throw new Error('Wing fixture');
    wing.target.identity.id = 'second';
    second(latest);
    await flushPromises();
    expect(vm.panel.value?.kind === 'variant' && vm.panel.value.variants[0]!.wings[0]!.id).toBe('second');
    first(baseline);
    await flushPromises();
    expect(vm.displaySnapshot.value!.records.find((record) => record.key === 'wing')!.target).toEqual(wing.target);
    mocks.projection.mockRejectedValueOnce(new Error('Source unavailable'));
    await vm.variant!.updateVariant('variant', (data) => equipVariantWing(data, 0, 'third'));
    await flushPromises();
    expect(jointObject(vm.joint.draftValue.value.variant).wings).toEqual(['third']);
    expect(vm.panel.value?.kind === 'variant' && vm.panel.value.variants[0]!.wings[0]!.id).toBe('second');
    expect(mocks.error).toHaveBeenCalled();
    wrapper.unmount();
  });
  function weaponCatalog(spec = { type: 'ENERGY', size: 'LARGE' }) {
    const snapshot = variantJointFixture();
    const source = snapshot.records.find((record) => record.key === 'weapon-spec')!.source!;
    mocks.query.mockResolvedValue(snapshot);
    mocks.projection.mockImplementation(async (draft) => structuredClone(draft.baseline));
    const entry = {
      id: 'test_weapon',
      label: 'Test Weapon',
      spec,
      data: {},
      source,
      specSource: source,
      sourceVersion: { path: source.path, fingerprint: 'v' },
    };
    mocks.catalog.mockResolvedValue({ catalog: { entries: [entry] } });
    return { snapshot, entry };
  }
  it('confirms an incompatible weapon then records one action for install, undo and redo', async () => {
    weaponCatalog();
    mocks.choose.mockResolvedValue('install');
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    expect(await vm.variant!.installVariantWeapon('variant', 'WS2', 'test_weapon')).toBe(true);
    expect(mocks.choose.mock.calls[0]![0].content).toContain('WS2 · BALLISTIC · MEDIUM');
    expect(mocks.choose.mock.calls[0]![0].content).toContain('武器尺寸超过槽位');
    expect(jointObject(vm.joint.draftValue.value.variant).weaponGroups).toMatchObject([{ weapons: { WS2: 'test_weapon' } }]);
    await vm.undo();
    expect(jointObject(vm.joint.draftValue.value.variant).weaponGroups).toMatchObject([{ weapons: { WS2: 'chaingun' } }]);
    expect(vm.history.canUndo.value).toBe(false);
    await vm.redo();
    expect(jointObject(vm.joint.draftValue.value.variant).weaponGroups).toMatchObject([{ weapons: { WS2: 'test_weapon' } }]);
    wrapper.unmount();
  });
  it.each([null, 'install'])('preserves the latest draft when confirmation returns %s after new editing', async (choice) => {
    weaponCatalog();
    let finish!: (value: string | null) => void;
    mocks.choose.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    const action = vm.variant!.installVariantWeapon('variant', 'WS2', 'test_weapon');
    await flushPromises();
    await vm.variant!.updateVariant('variant', (data) => ({ ...data, displayName: 'Later' }));
    finish(choice);
    expect(await action).toBe(false);
    expect(jointObject(vm.joint.draftValue.value.variant)).toMatchObject({
      displayName: 'Later',
      weaponGroups: [{ weapons: { WS2: 'chaingun' } }],
    });
    wrapper.unmount();
  });
  it('installs a compatible candidate and unloads it without an incompatibility confirmation', async () => {
    weaponCatalog({ type: 'BALLISTIC', size: 'SMALL' });
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    expect(await vm.variant!.installVariantWeapon('variant', 'WS2', 'test_weapon')).toBe(true);
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(await vm.variant!.installVariantWeapon('variant', 'WS2', '')).toBe(true);
    expect(jointObject(vm.joint.draftValue.value.variant).weaponGroups).toMatchObject([{ weapons: {} }]);
    wrapper.unmount();
  });
  it('rejects newly typed input and releases unmounted confirmation requests', async () => {
    weaponCatalog();
    let finish!: (value: string) => void;
    mocks.choose.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    const action = vm.variant!.installVariantWeapon('variant', 'WS2', 'test_weapon');
    await flushPromises();
    const dirty = ref(true);
    vm.joint.inputs.register({ key: 'later', dirty, label: 'Later', commit: () => null, focus: vi.fn(), cancel: vi.fn() });
    finish('install');
    expect(await action).toBe(false);
    dirty.value = false;
    const closed = vm.variant!.installVariantWeapon('variant', 'WS2', 'test_weapon');
    await flushPromises();
    wrapper.unmount();
    finish('install');
    expect(await closed).toBe(false);
    expect(vm.history.canUndo.value).toBe(false);
  });
  it('rejects a changed candidate source and late confirmation after picker cancellation', async () => {
    const { entry } = weaponCatalog();
    mocks.choose.mockResolvedValue('install');
    mocks.catalog
      .mockResolvedValueOnce({ catalog: { entries: [entry] } })
      .mockResolvedValueOnce({ catalog: { entries: [{ ...entry, sourceVersion: { ...entry.sourceVersion, fingerprint: 'next' } }] } });
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    expect(await vm.variant!.installVariantWeapon('variant', 'WS2', 'test_weapon')).toBe(false);
    let finish!: (value: string) => void;
    mocks.choose.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const action = vm.variant!.installVariantWeapon('variant', 'WS2', 'test_weapon');
    await flushPromises();
    vm.variant!.cancelVariantAction();
    finish('install');
    expect(await action).toBe(false);
    expect(vm.history.canUndo.value).toBe(false);
    wrapper.unmount();
  });
  it('waits for manual missing-ID confirmation inside the active save input finalizer', async () => {
    const { snapshot } = weaponCatalog();
    mocks.choose.mockResolvedValue('install');
    mocks.save.mockImplementation(async () => null);
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    let pending = true;
    vm.joint.inputs.registerFinalizer(async () => {
      if (!pending) return;
      pending = false;
      return vm.variant!.installVariantWeapon('variant', 'WS2', 'missing_weapon', true);
    }, 'manual');
    await vm.joint.saveDraft();
    expect(mocks.choose.mock.calls[0]![0].content).toContain('武器目录来源缺失');
    expect(mocks.save.mock.calls[0]![0].values.variant.value.weaponGroups).toMatchObject([{ weapons: { WS2: 'missing_weapon' } }]);
    expect(snapshot.root.kind).toBe('variant');
    wrapper.unmount();
  });
  it.each(['replace', 'remove', 'cancel', 'failure'] as const)(
    'handles module reference %s through the existing save switch',
    async (mode) => {
      const baseline = sharedVariant();
      const { vm, wrapper } = editor('variant');
      await vm.initialize();
      const id = mode === 'remove' ? '' : 'replacement';
      let commit = 100;
      mocks.save.mockImplementation(async (draft) => {
        if (mode === 'failure') throw new Error('save failed');
        const next = structuredClone(baseline);
        for (const record of next.records) if (draft.values[record.key]) record.value = structuredClone(draft.values[record.key]);
        mocks.query.mockResolvedValue(next);
        return { ...savedWriteFixture(), commitId: ++commit, refreshedEntity: next };
      });
      if (mode === 'cancel') {
        await vm.variant!.updateVariant('variant', (data) => ({ ...data, fluxVents: 12 }));
        mocks.choose.mockResolvedValue(null);
      }
      const accepted = await vm.variant!.installVariantModule('variant', 'M', id);
      expect(accepted).toBe(mode === 'replace' || mode === 'remove');
      const modules = jointObject(vm.joint.draftValue.value.variant).modules;
      expect(modules).toEqual(
        mode === 'replace' ? { M: id, N: 'module' } : mode === 'remove' ? { N: 'module' } : { M: 'module', N: 'module' },
      );
      expect(vm.referenceChanging.value).toBe(false);
      expect(vm.variantActionPending.value).toBe(false);
      wrapper.unmount();
    },
  );
  it.each(['install', null])('confirms a missing module ID and preserves cancellation %s', async (choice) => {
    sharedVariant();
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    mocks.candidate.mockResolvedValue({ ...variantJointFixture(), hull: null });
    mocks.choose.mockResolvedValue(choice);
    if (choice === null) {
      expect(await vm.variant!.installVariantModule('variant', 'M', 'missing', true)).toBe(false);
      expect(mocks.save).not.toHaveBeenCalled();
    } else {
      mocks.save.mockRejectedValueOnce(new Error('expected save failure'));
      expect(await vm.variant!.installVariantModule('variant', 'M', 'missing', true)).toBe(false);
    }
    expect(mocks.choose.mock.calls[0]![0].content).toContain('来源缺失');
    expect(jointObject(vm.joint.draftValue.value.variant).modules).toEqual({ M: 'module', N: 'module' });
    wrapper.unmount();
  });
  it('commits a pending manual module reference inside the ongoing save once', async () => {
    const baseline = sharedVariant();
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    mocks.candidate.mockResolvedValue({ ...variantJointFixture(), hull: null });
    mocks.choose.mockResolvedValue('install');
    mocks.save.mockImplementation(async (draft) => {
      const next = structuredClone(baseline);
      for (const record of next.records) if (draft.values[record.key]) record.value = structuredClone(draft.values[record.key]);
      return { ...savedWriteFixture(), refreshedEntity: next };
    });
    let pending = true;
    vm.joint.inputs.registerFinalizer(async () => {
      if (!pending) return;
      pending = false;
      return vm.variant!.installVariantModule('variant', 'M', 'manual_module', true);
    }, 'manual-module');
    await vm.joint.saveDraft();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0]![0].values.variant.value.modules.M).toBe('manual_module');
    wrapper.unmount();
  });
  function sharedVariant() {
    const snapshot = variantJointFixture(),
      root = snapshot.records.find((record) => record.key === 'variant')!;
    root.value = { state: 'present', value: { ...jointObject(root.value), modules: { M: 'module', N: 'module' } } };
    snapshot.variants.variant!.slots.push({ id: 'M', type: 'STATION_MODULE' }, { id: 'N', type: 'STATION_MODULE' });
    snapshot.variants.variant!.modules = [
      { slotId: 'M', variantKey: 'module' },
      { slotId: 'N', variantKey: 'module' },
    ];
    const target = entityTargetFixture('variant', 'module');
    snapshot.records.push({
      ...structuredClone(root),
      key: 'module',
      target: { kind: 'spec', target },
      source: target.write,
      value: {
        state: 'present',
        value: { variantId: 'module', hullId: 'aurora', fluxVents: 8, fluxCapacitors: 3, hullMods: ['rangefinder'], weaponGroups: [] },
      },
    });
    snapshot.variants.module = { ...structuredClone(snapshot.variants.variant!), variantKey: 'module', modules: [] };
    mocks.query.mockResolvedValue(snapshot);
    mocks.projection.mockImplementation(async (draft) => structuredClone(draft.baseline));
    return snapshot;
  }
  it('confirms the shared branch and records one history action for all records', async () => {
    sharedVariant();
    mocks.choose.mockResolvedValue('strip');
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    expect(await vm.variant!.stripVariantBranch('variant')).toBe(true);
    expect(vm.joint.draftValue.value.variant).toMatchObject({ state: 'present', value: { fluxCapacitors: 0, fluxVents: 0 } });
    expect(vm.joint.draftValue.value.module).toMatchObject({ state: 'present', value: { fluxCapacitors: 0, fluxVents: 0, hullMods: [] } });
    expect(mocks.choose.mock.calls[0]![0].content).toContain('2 个装配');
    await vm.undo();
    expect(jointObject(vm.joint.draftValue.value.module).fluxVents).toBe(8);
    expect(jointObject(vm.joint.draftValue.value.variant).fluxCapacitors).toBe(4);
    expect(vm.history.canUndo.value).toBe(false);
    await vm.redo();
    expect(jointObject(vm.joint.draftValue.value.module).fluxVents).toBe(0);
    wrapper.unmount();
  });
  it('preserves the draft when strip confirmation is cancelled', async () => {
    sharedVariant();
    mocks.choose.mockResolvedValue(null);
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    expect(await vm.variant!.stripVariantBranch('variant')).toBe(false);
    expect(jointObject(vm.joint.draftValue.value.variant).fluxCapacitors).toBe(4);
    expect(vm.history.canUndo.value).toBe(false);
    wrapper.unmount();
  });
  it('creates explicit Core overrides before clearing and keeps one clearing history action', async () => {
    const snapshot = sharedVariant();
    const core = snapshot.records.find((record) => record.key === 'module')!;
    core.source = { ...core.source!, source: 'core' };
    mocks.choose.mockResolvedValue('strip');
    mocks.save.mockImplementationOnce(async () => {
      const after = structuredClone(snapshot);
      after.records.find((record) => record.key === 'module')!.source = { ...core.source!, source: 'mod' };
      return { ...savedWriteFixture(), refreshedEntity: after };
    });
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    expect(await vm.variant!.stripVariantBranch('variant')).toBe(true);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0]![3]).toEqual(['module']);
    expect(jointObject(vm.joint.draftValue.value.module).fluxVents).toBe(0);
    await vm.undo();
    expect(jointObject(vm.joint.draftValue.value.module).fluxVents).toBe(8);
    wrapper.unmount();
  });
  it('keeps Core drafts when override creation is cancelled', async () => {
    const snapshot = sharedVariant();
    const core = snapshot.records.find((record) => record.key === 'module')!;
    core.source = { ...core.source!, source: 'core' };
    mocks.save.mockResolvedValueOnce(null);
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    expect(await vm.variant!.stripVariantBranch('variant')).toBe(false);
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(jointObject(vm.joint.draftValue.value.module).fluxVents).toBe(8);
    wrapper.unmount();
  });
  it('clears a selected module branch and leaves its parent record intact', async () => {
    sharedVariant();
    mocks.choose.mockResolvedValue('strip');
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    expect(await vm.variant!.stripVariantBranch('module')).toBe(true);
    expect(jointObject(vm.joint.draftValue.value.variant).fluxCapacitors).toBe(4);
    expect(jointObject(vm.joint.draftValue.value.module).fluxVents).toBe(0);
    wrapper.unmount();
  });
  it('keeps newly typed raw input when confirmation finishes late', async () => {
    sharedVariant();
    let finish!: (value: string) => void;
    mocks.choose.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    const action = vm.variant!.stripVariantBranch('variant');
    await flushPromises();
    const raw = ref(true);
    vm.joint.inputs.register({
      key: 'late-raw',
      label: '数值',
      dirty: raw,
      commit: () => null,
      cancel: () => {
        raw.value = false;
      },
      focus: () => {},
    });
    finish('strip');
    expect(await action).toBe(false);
    expect(raw.value).toBe(true);
    expect(jointObject(vm.joint.draftValue.value.module).fluxVents).toBe(8);
    wrapper.unmount();
  });
  it('treats a second strip as an equal draft and preserves a single undo step', async () => {
    sharedVariant();
    mocks.choose.mockResolvedValue('strip');
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    await vm.variant!.stripVariantBranch('variant');
    await vm.variant!.stripVariantBranch('variant');
    await vm.undo();
    expect(jointObject(vm.joint.draftValue.value.module).fluxVents).toBe(8);
    expect(vm.history.canUndo.value).toBe(false);
    wrapper.unmount();
  });
  it('keeps edits made during confirmation and rejects the captured clearing action', async () => {
    sharedVariant();
    let finish!: (value: string) => void;
    mocks.choose.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    const action = vm.variant!.stripVariantBranch('variant');
    await flushPromises();
    await vm.variant!.updateVariant('module', (data) => ({ ...data, displayName: 'Later' }));
    finish('strip');
    expect(await action).toBe(false);
    expect(jointObject(vm.joint.draftValue.value.module)).toMatchObject({ fluxVents: 8, displayName: 'Later' });
    wrapper.unmount();
  });
  it('releases an unmounted strip request and ignores its late confirmation', async () => {
    sharedVariant();
    let finish!: (value: string) => void;
    mocks.choose.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    const action = vm.variant!.stripVariantBranch('variant');
    await flushPromises();
    wrapper.unmount();
    expect(await action).toBe(false);
    finish('strip');
    await flushPromises();
    expect(vm.joint.currentTarget.value).toBeNull();
    expect(vm.joint.draftValue.value).toEqual({});
  });
  it('follows module identity with stable fields, dirty data and draft history', async () => {
    const snapshot = variantJointFixture(),
      root = snapshot.records.find((record) => record.key === 'variant')!;
    root.value = { state: 'present', value: { ...jointObject(root.value), modules: [{ M: 'module' }] } };
    const target = entityTargetFixture('variant', 'module');
    snapshot.records.push({
      ...structuredClone(root),
      key: 'module',
      target: { kind: 'spec', target },
      source: target.write,
      value: { state: 'present', value: { variantId: 'module', hullId: 'aurora', displayName: 'Module', fluxVents: 0 } },
    });
    snapshot.variants.variant!.modules = [{ slotId: 'M', variantKey: 'module' }];
    snapshot.variants.module = { ...structuredClone(snapshot.variants.variant!), variantKey: 'module', modules: [] };
    mocks.query.mockResolvedValue(snapshot);
    mocks.projection.mockImplementation(async (draft) => structuredClone(draft.baseline));
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    await vm.variant!.updateVariant('module', (data) => ({ ...data, fluxVents: 7 }));
    const next = structuredClone(snapshot),
      record = next.records.find((item) => item.key === 'module')!;
    record.key = 'next-module';
    record.target = { kind: 'spec', target: entityTargetFixture('variant', 'module_new') };
    record.value = { state: 'present', value: { ...jointObject(record.value), variantId: 'module_new' } };
    next.records.find((item) => item.key === 'variant')!.value = {
      state: 'present',
      value: { ...jointObject(root.value), modules: [{ M: 'module_new' }] },
    };
    next.variants.variant!.modules = [{ slotId: 'M', variantKey: 'next-module' }];
    next.variants['next-module'] = { ...next.variants.module!, variantKey: 'next-module' };
    delete next.variants.module;
    mocks.query.mockResolvedValue(next);
    const receipt = { ...savedWriteFixture(), identityChanges: [{ before: target, after: entityTargetFixture('variant', 'module_new') }] };
    await mocks.listen.mock.calls[0]![0]({ sessionId: 's', modRoot: 'M:/mod', result: receipt });
    await flushPromises();
    expect(vm.joint.draftValue.value['next-module']).toMatchObject({ state: 'present', value: { variantId: 'module_new', fluxVents: 7 } });
    expect(vm.joint.draftValue.value.variant).toMatchObject({ state: 'present', value: { modules: [{ M: 'module_new' }] } });
    expect(vm.panel.value?.kind === 'variant' && vm.panel.value.variants.find((item) => item.key === 'next-module')?.fields[3]?.id).toBe(
      'variant/M/fluxVents',
    );
    await vm.undo();
    expect(vm.joint.draftValue.value['next-module']).toMatchObject({ state: 'present', value: { variantId: 'module_new', fluxVents: 0 } });
    wrapper.unmount();
  });
  function prepareVariant() {
    const snapshot = variantJointFixture();
    mocks.query.mockResolvedValue(snapshot);
    mocks.projection.mockImplementation(async (draft) => structuredClone(draft.baseline));
    return snapshot;
  }
  it('commits the active input before one variant action and preserves draft history', async () => {
    prepareVariant();
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    const inputDirty = ref(true);
    vm.joint.inputs.register({
      key: 'pending-variant',
      label: '名称',
      dirty: inputDirty,
      commit: () => {
        vm.variant!.applyVariantAction('variant', (data) => ({ ...data, displayName: 'Submitted' }));
        inputDirty.value = false;
        return null;
      },
      cancel: () => {},
      focus: () => {},
    });
    await vm.variant!.updateVariant('variant', (data) => ({ ...data, fluxCapacitors: 5 }));
    expect(vm.joint.draftValue.value.variant).toMatchObject({ state: 'present', value: { displayName: 'Submitted', fluxCapacitors: 5 } });
    await vm.undo();
    expect(vm.joint.draftValue.value.variant).toMatchObject({ state: 'present', value: { displayName: 'Submitted', fluxCapacitors: 4 } });
    await vm.redo();
    expect(vm.joint.draftValue.value.variant).toMatchObject({ state: 'present', value: { fluxCapacitors: 5 } });
    wrapper.unmount();
  });
  it('keeps invalid active raw input and its owner when an action is requested', async () => {
    prepareVariant();
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    vm.joint.inputs.register({
      key: 'invalid-variant',
      label: '幅能寄存器',
      dirty: ref(true),
      commit: () => '请输入完整整数',
      cancel: () => {},
      focus: () => {},
    });
    expect(await vm.variant!.updateVariant('variant', (data) => ({ ...data, fluxCapacitors: 9 }))).toBe(false);
    expect(vm.joint.draftValue.value.variant).toMatchObject({ state: 'present', value: { fluxCapacitors: 4 } });
    expect(vm.joint.inputs.dirty.value).toBe(true);
    expect(mocks.error).toHaveBeenCalled();
    wrapper.unmount();
  });
  it('keeps concurrent post-submit variant fields while accepting the receipt', async () => {
    const snapshot = prepareVariant();
    const { vm, wrapper } = editor('variant');
    await vm.initialize();
    await vm.variant!.updateVariant('variant', (data) => ({ ...data, fluxCapacitors: 5 }));
    let finish!: (value: unknown) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = vm.save();
    await flushPromises();
    await vm.variant!.updateVariant('variant', (data) => ({ ...data, displayName: 'Later' }));
    const after = structuredClone(snapshot);
    after.records.find((record) => record.key === 'variant')!.value = {
      state: 'present',
      value: { ...jointObject(snapshot.records.find((record) => record.key === 'variant')!.value), fluxCapacitors: 5 },
    };
    finish({ ...savedWriteFixture(), refreshedEntity: after });
    await saving;
    expect(vm.joint.draftValue.value.variant).toMatchObject({ state: 'present', value: { displayName: 'Later', fluxCapacitors: 5 } });
    expect(vm.joint.dirty.value).toBe(true);
    wrapper.unmount();
  });
});

describe('wing joint source handoff', () => {
  it('creates a missing fighter through the wing action and submits its captured source', async () => {
    const baseline = prepare();
    baseline.records.find((record) => record.key === 'spec')!.value = { state: 'missing' };
    mocks.choose.mockResolvedValueOnce('ship');
    mocks.save.mockResolvedValueOnce(null);
    const { vm, wrapper } = editor('wing');
    await vm.initialize();
    await vm.wing!.createMissingSource('spec');
    expect(vm.joint.draftValue.value.spec).toMatchObject({ state: 'present', value: { hullId: 'sarissa', hullSize: 'FIGHTER' } });
    expect(mocks.save.mock.calls[0]![0].values.spec).toEqual(vm.joint.draftValue.value.spec);
    await vm.undo();
    expect(vm.joint.draftValue.value.spec).toEqual({ state: 'missing' });
    wrapper.unmount();
  });
  it('hands a missing hull to a Skin graph using the authoritative wing row', async () => {
    const baseline = prepare();
    baseline.records.find((record) => record.key === 'spec')!.value = { state: 'missing' };
    const { vm, wrapper } = editor('wing');
    await vm.initialize();
    mocks.choose.mockResolvedValueOnce('skin');
    const skinGraph = structuredClone(baseline);
    skinGraph.newSources = [{ kind: 'skin', id: 'sarissa' }];
    mocks.query.mockResolvedValueOnce(skinGraph);
    await vm.wing!.createMissingSource('spec');
    expect(mocks.query).toHaveBeenLastCalledWith(baseline.root, 'wing-row', expect.any(AbortSignal), skinGraph.newSources);
    expect(vm.snapshot.value!.newSources).toEqual(skinGraph.newSources);
    expect(vm.selectedStatId.value).toBe('skin-base-reference');
    expect(vm.referenceChanging.value).toBe(false);
    wrapper.unmount();
  });
  it('continues Skin creation using the identity returned by its own dirty save', async () => {
    const baseline = prepare();
    baseline.records.find((record) => record.key === 'spec')!.value = { state: 'missing' };
    const { vm, wrapper } = editor('wing');
    await vm.initialize();
    const panel = vm.panel.value;
    if (panel?.kind !== 'wing') throw new Error('wing fixture');
    vm.updateField(panel.technical.find((stat) => stat.id === 'num')!.fields[0]!, { kind: 'set', value: 4 });
    const saved = structuredClone(baseline);
    saved.root.id = 'next-wing';
    saved.records.find((record) => record.key === 'wing')!.value = {
      state: 'present',
      value: { id: 'next-wing', num: '4', variant: 'sarissa_Fighter' },
    };
    mocks.choose.mockResolvedValueOnce('skin').mockResolvedValueOnce('save');
    mocks.save.mockResolvedValueOnce({ ...savedWriteFixture(), refreshedEntity: saved });
    const graph = { ...saved, newSources: [{ kind: 'skin' as const, id: 'sarissa' }] };
    mocks.query.mockResolvedValueOnce(graph);
    await vm.wing!.createMissingSource('spec');
    expect(mocks.query).toHaveBeenLastCalledWith(saved.root, 'wing-row', expect.any(AbortSignal), graph.newSources);
    expect(vm.snapshot.value!.newSources).toEqual(graph.newSources);
    expect(vm.selectedStatId.value).toBe('skin-base-reference');
    wrapper.unmount();
  });
  it.each(['external', 'unmount'] as const)('releases a missing-source choice after %s handoff', async (handoff) => {
    const baseline = prepare();
    baseline.records.find((record) => record.key === 'spec')!.value = { state: 'missing' };
    const { vm, wrapper } = editor('wing');
    await vm.initialize();
    let finish!: (value: string) => void;
    mocks.choose.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const creating = vm.wing!.createMissingSource('spec');
    await flushPromises();
    if (handoff === 'unmount') wrapper.unmount();
    else {
      mocks.query.mockResolvedValueOnce(wingJointFixture());
      await vm.joint.refreshTarget(vm.joint.currentTarget.value!);
    }
    finish('ship');
    await creating;
    expect(mocks.save).not.toHaveBeenCalled();
    expect(vm.history.canUndo.value).toBe(false);
    if (handoff === 'external') wrapper.unmount();
  });
  it('follows the persisted wing row while preserving dirty values, raw input and undo history', async () => {
    const baseline = prepare();
    const { vm, wrapper } = editor('wing');
    await vm.initialize();
    const panel = vm.panel.value;
    if (panel?.kind !== 'wing') throw new Error('wing fixture');
    vm.updateField(panel.technical.find((stat) => stat.id === 'num')!.fields[0]!, { kind: 'set', value: 4 });
    let raw = '1e';
    const inputDirty = ref(true);
    vm.joint.inputs.register({
      key: 'raw-wing-input',
      label: '结构',
      dirty: inputDirty,
      commit: () => '请输入完整有效数字',
      focus: () => {},
      cancel: () => {
        raw = '';
        inputDirty.value = false;
      },
    });
    const next = structuredClone(baseline);
    next.root.id = 'renamed-wing';
    const row = next.records.find((record) => record.key === 'wing')!;
    row.key = 'next-wing';
    if (row.target.kind === 'csv') row.target.identity.id = 'renamed-wing';
    if (row.value.state === 'present')
      row.value = {
        state: 'present',
        value: { ...(row.value.value as Record<string, import('@/shared/types').JsonValue>), id: 'renamed-wing' },
      };
    next.bindings.csv = 'next-wing';
    mocks.query.mockResolvedValue(next);
    const update = sessionUpdateFixture('s', 'M:/mod');
    if (update.status !== 'ready') throw new Error('projection fixture');
    update.projection.invalidation.paths = ['data/hulls/wing_data.csv'];
    await mocks.projectUpdates[0]!(update.projection);
    expect(vm.joint.currentTarget.value!.id).toBe('renamed-wing');
    expect(vm.joint.draftValue.value['next-wing']).toMatchObject({ state: 'present', value: { id: 'renamed-wing', num: '4' } });
    expect(raw).toBe('1e');
    expect(vm.history.canUndo.value).toBe(true);
    vm.joint.inputs.cancel('raw-wing-input');
    await vm.undo();
    expect(vm.joint.draftValue.value['next-wing']).toMatchObject({ state: 'present', value: { id: 'renamed-wing', num: '3' } });
    wrapper.unmount();
  });
  function prepare() {
    const snapshot = wingJointFixture();
    mocks.query.mockResolvedValue(snapshot);
    mocks.projection.mockImplementation(async (draft) => structuredClone(draft.baseline));
    return snapshot;
  }
  it('edits two title sources as one history action and keeps the wing isolated', async () => {
    prepare();
    const { vm, wrapper } = editor('wing');
    await vm.initialize();
    const fields = vm.panel.value!.heading[0]!.fields;
    vm.updateFields(fields.map((field, index) => ({ field, update: { kind: 'set' as const, value: index ? 'New variant' : 'New hull' } })));
    expect(vm.panel.value!.heading[0]!.display).toBe('New hull New variant');
    expect(vm.joint.draftValue.value.wing).toMatchObject({ state: 'present', value: { id: 'sarissa_wing' } });
    await vm.undo();
    expect(vm.panel.value!.heading[0]!.display).toBe('Sarissa Support Fighter');
    expect(vm.history.canUndo.value).toBe(false);
    wrapper.unmount();
  });
  it('keeps the old reference and all source drafts when the save handoff is cancelled', async () => {
    prepare();
    const { vm, wrapper } = editor('wing');
    await vm.initialize();
    const panel = vm.panel.value;
    if (panel?.kind !== 'wing') throw new Error('wing fixture');
    vm.updateField(panel.technical.find((stat) => stat.id === 'hitpoints')!.fields[0]!, { kind: 'set', value: 810 });
    mocks.choose.mockResolvedValue(null);
    await vm.updateFields([{ field: panel.sources[0]!.fields[0]!, update: { kind: 'set', value: 'other' } }]);
    expect(vm.joint.draftValue.value.wing).toMatchObject({ state: 'present', value: { variant: 'sarissa_Fighter' } });
    expect(vm.joint.draftValue.value['hull-csv']).toMatchObject({ state: 'present', value: { hitpoints: '810' } });
    expect(vm.referenceChanging.value).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('saves the current draft before the reference and then reads the authoritative source graph', async () => {
    const baseline = prepare();
    const { vm, wrapper } = editor('wing');
    await vm.initialize();
    const panel = vm.panel.value;
    if (panel?.kind !== 'wing') throw new Error('wing fixture');
    vm.updateField(panel.technical.find((stat) => stat.id === 'hitpoints')!.fields[0]!, { kind: 'set', value: 810 });
    mocks.choose.mockResolvedValue('save');
    let commit = 0;
    mocks.save.mockImplementation(async (draft) => {
      const actual = structuredClone(baseline);
      for (const record of actual.records) if (draft.values[record.key]) record.value = structuredClone(draft.values[record.key]);
      if (commit === 1) mocks.query.mockResolvedValue(actual);
      return { ...savedWriteFixture(), commitId: ++commit, refreshedEntity: actual };
    });
    await vm.updateFields([{ field: panel.sources[0]!.fields[0]!, update: { kind: 'set', value: 'other' } }]);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[0]![0].values.wing.value.variant).toBe('sarissa_Fighter');
    expect(mocks.save.mock.calls[1]![0].values.wing.value.variant).toBe('other');
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'wing' }), 'wing-row', expect.any(AbortSignal), []);
    expect(vm.referenceChanging.value).toBe(false);
    wrapper.unmount();
  });
  it('restores the original reference on a pre-commit failure', async () => {
    prepare();
    const { vm, wrapper } = editor('wing');
    await vm.initialize();
    const panel = vm.panel.value;
    if (panel?.kind !== 'wing') throw new Error('wing fixture');
    mocks.save.mockRejectedValueOnce(new Error('version conflict'));
    await vm.updateFields([{ field: panel.sources[0]!.fields[0]!, update: { kind: 'set', value: 'other' } }]);
    expect(vm.joint.draftValue.value.wing).toMatchObject({ state: 'present', value: { variant: 'sarissa_Fighter' } });
    expect(mocks.error).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
describe('immersive ship lifecycle and reference channels', () => {
  it('retries initialization and refresh failures while preserving the current draft', async () => {
    mocks.query.mockRejectedValueOnce(new Error('Initial unavailable'));
    const { vm, wrapper } = editor();
    await vm.retry();
    expect(vm.errorText.value).toContain('Initial unavailable');
    expect(vm.joint.ready.value).toBe(false);
    await vm.retry();
    expect(vm.errorText.value).toBe('');
    expect(vm.joint.ready.value).toBe(true);
    vm.logSlowPreparation();
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith({
      level: 'warning',
      code: 'immersive.preparation_slow',
      message: 'immersive editor preparation exceeded 12 seconds',
      path: null,
      line: null,
      fields: { sessionId: 's', modRoot: 'M:/mod', kind: 'ship', id: 'lasher', waitMs: '12000', phase: 'read' },
    });
    vm.updateField(vm.panel.value!.heading[0]!.fields[0]!, { kind: 'set', value: 'Draft name' });
    mocks.query.mockRejectedValueOnce(new Error('Refresh unavailable'));
    await vm.retry();
    expect(vm.errorText.value).toContain('Refresh unavailable');
    expect(vm.panel.value!.heading[0]!.display).toBe('Draft name');
    const next = shipJointFixture();
    next.records[1]!.value = { state: 'present', value: { id: 'lasher', name: 'External name' } };
    mocks.query.mockResolvedValueOnce(next);
    await vm.retry();
    expect(vm.errorText.value).toBe('');
    expect(vm.panel.value!.heading[0]!.display).toBe('Draft name');
    expect(vm.joint.hasPendingExternalValue.value).toBe(true);
    expect(mocks.listen).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it('opens the projectile reference produced by committing the active weapon input', async () => {
    mocks.query.mockResolvedValue(weaponJointFixture());
    const { vm, wrapper } = editor('weapon');
    await vm.initialize();
    const panel = vm.panel.value;
    if (panel?.kind !== 'weapon') throw new Error('weapon panel');
    const dirty = ref(true);
    vm.joint.inputs.register({
      key: 'projectile-reference',
      label: '弹体引用',
      dirty,
      commit: () => {
        vm.updateField(panel.projectile!.fields[0]!, { kind: 'set', value: 'new_shot' });
        dirty.value = false;
        return null;
      },
      focus: vi.fn(),
      cancel: vi.fn(),
    });
    await vm.openProjectile!();
    expect(mocks.openProjectile).toHaveBeenCalledExactlyOnceWith({
      sessionId: 's',
      modRoot: 'M:/mod',
      id: 'new_shot',
      starsectorRoot: null,
    });
    expect(vm.history.canUndo.value).toBe(true);
    wrapper.unmount();
  });
  it.each(['cancel', 'release'] as const)('ends a pending projectile open after %s', async (reason) => {
    mocks.query.mockResolvedValue(weaponJointFixture());
    const { vm, wrapper } = editor('weapon');
    await vm.initialize();
    let finish!: () => void;
    vm.joint.inputs.registerFinalizer(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const opening = vm.openProjectile!();
    await flushPromises();
    if (reason === 'cancel') vm.joint.inputs.cancel();
    else wrapper.unmount();
    finish();
    await opening;
    expect(mocks.openProjectile).not.toHaveBeenCalled();
    if (reason === 'cancel') wrapper.unmount();
  });
  it('keeps the Core pulse source unchanged when branch selection is cancelled', async () => {
    const snapshot = weaponJointFixture();
    snapshot.records[0]!.source = { ...snapshot.records[0]!.source!, source: 'core' };
    if (snapshot.records[0]!.value.state === 'present')
      snapshot.records[0]!.value.value = { id: 'chaingun', specClass: 'pulse', custom: 'retained' };
    mocks.query.mockResolvedValue(snapshot);
    mocks.choose.mockResolvedValue(null);
    const { vm, wrapper } = editor('weapon');
    await vm.initialize();
    await vm.createOverrides();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(vm.joint.draftValue.value.spec).toMatchObject({ state: 'present', value: { specClass: 'pulse', custom: 'retained' } });
    expect(vm.joint.dirty.value).toBe(false);
    wrapper.unmount();
  });
  it('chooses a legal Core pulse branch before the explicit override save and accepts its corrected baseline', async () => {
    const snapshot = weaponJointFixture();
    snapshot.records[0]!.source = { ...snapshot.records[0]!.source!, source: 'core' };
    if (snapshot.records[0]!.value.state === 'present')
      snapshot.records[0]!.value.value = { id: 'chaingun', specClass: 'pulse', custom: 'retained' };
    mocks.query.mockResolvedValue(snapshot);
    mocks.choose.mockResolvedValue('beam');
    const actual = weaponJointFixture();
    actual.records[0]!.value = {
      state: 'present',
      value: { id: 'chaingun', specClass: 'beam', custom: 'retained', textureType: 'SMOOTH' },
    };
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), refreshedEntity: actual });
    mocks.projection.mockResolvedValue(actual);
    const { vm, wrapper } = editor('weapon');
    await vm.initialize();
    await vm.createOverrides();
    expect(mocks.save.mock.calls[0]![0].values.spec).toMatchObject({
      state: 'present',
      value: { specClass: 'beam', textureType: 'SMOOTH', custom: 'retained' },
    });
    expect(mocks.save.mock.calls[0]![3]).toEqual(['spec']);
    expect(vm.joint.draftValue.value.spec).toEqual(actual.records[0]!.value);
    expect(vm.joint.dirty.value).toBe(false);
    wrapper.unmount();
  });
  it('submits a weapon parameter batch as one history action and preserves branch fields', async () => {
    mocks.query.mockResolvedValue(weaponJointFixture());
    const { vm, wrapper } = editor('weapon');
    await vm.initialize();
    await flushPromises();
    const panel = vm.panel.value;
    if (panel?.kind !== 'weapon') throw new Error('weapon panel');
    const fields = panel.primary.find((stat) => stat.id === 'dps')!.fields;
    vm.updateFields([
      { field: fields.find((field) => field.schema.key === 'damage/shot')!, update: { kind: 'set', value: 90 } },
      { field: fields.find((field) => field.schema.key === 'chargedown')!, update: { kind: 'set', value: 0.3 } },
    ]);
    expect(vm.joint.draftValue.value.csv).toMatchObject({ state: 'present', value: { 'damage/shot': '90', chargedown: '0.3' } });
    await vm.undo();
    expect(vm.joint.draftValue.value.csv).toMatchObject({ state: 'present', value: { 'damage/shot': '75', chargedown: '0.15' } });
    expect(vm.history.canUndo.value).toBe(false);
    vm.updateField(panel.branch.fields[0]!, { kind: 'set', value: 'beam' });
    expect(vm.joint.draftValue.value.spec).toMatchObject({
      state: 'present',
      value: { specClass: 'beam', textureType: 'SMOOTH', unknown: { retained: true } },
    });
    await vm.undo();
    expect(vm.joint.draftValue.value.spec).toMatchObject({ state: 'present', value: { specClass: 'projectile' } });
    wrapper.unmount();
  });
  it('follows a rename during initial loading through the authoritative CSV row and ignores the old result', async () => {
    const { vm, wrapper } = editor();
    let finish!: (snapshot: JointEditSnapshot) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = vm.initialize();
    await flushPromises();
    expect(vm.snapshot.value).toBeNull();
    const before = shipJointFixture().records[0]!;
    if (before.target.kind !== 'spec') throw new Error('spec fixture');
    const after = {
      ...before.target.target,
      id: 'renamed',
      linkedRecord: { kind: 'csv' as const, table: 'ships' as const, rowKey: 'stable-row' },
    };
    const next = shipJointFixture();
    next.root.id = 'renamed';
    next.records[0]!.target = { kind: 'spec', target: after };
    next.records[0]!.value = { state: 'present', value: { hullId: 'renamed', hullSize: 'FRIGATE' } };
    mocks.query.mockResolvedValue(next);
    const handler = mocks.listen.mock.calls[0]![0] as (event: EntityIdentityAppliedEvent) => Promise<void>;
    await handler({
      sessionId: 's',
      modRoot: 'M:/mod',
      result: { ...savedWriteFixture(), identityChanges: [{ before: before.target.target, after }] },
    });
    await opening;
    expect(vm.joint.currentTarget.value!.id).toBe('renamed');
    expect(vm.joint.ready.value).toBe(true);
    finish(shipJointFixture());
    await flushPromises();
    expect(vm.joint.currentTarget.value!.id).toBe('renamed');
    wrapper.unmount();
  });
  it('rereads associations after accepting the actual saved record values', async () => {
    const { vm, wrapper } = editor();
    await vm.initialize();
    await flushPromises();
    const projection = shipJointFixture();
    projection.records.find((record) => record.key === 'system-csv')!.value = {
      state: 'present',
      value: { id: 'ammofeed', name: 'Selected system' },
    };
    mocks.projection.mockResolvedValue(projection);
    vm.updateField(shipPanel(vm).system.fields[0]!, { kind: 'set', value: 'next' });
    await flushPromises();
    expect(shipPanel(vm).system.display).toBe('Selected system');
    const actual = shipJointFixture();
    actual.records[1]!.value = { state: 'present', value: { 'system id': 'next', id: 'lasher', name: 'Lasher' } };
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), refreshedEntity: actual });
    await vm.save();
    await flushPromises();
    expect(mocks.projection).toHaveBeenCalledTimes(2);
    expect(shipPanel(vm).system.display).toBe('Selected system');
    expect(mocks.error).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('keeps the old identity when native retarget fails and follows on retry with the draft history intact', async () => {
    const { vm, wrapper } = editor();
    await vm.initialize();
    await flushPromises();
    vm.updateField(vm.panel.value!.heading[0]!.fields[0]!, { kind: 'set', value: 'My name' });
    const before = shipJointFixture().records[0]!;
    if (before.target.kind !== 'spec') throw new Error('spec fixture');
    const after = { ...before.target.target, id: 'renamed' };
    const next = shipJointFixture();
    next.root.id = 'renamed';
    next.records[0]!.target = { kind: 'spec', target: after };
    next.records[0]!.value = { state: 'present', value: { hullId: 'renamed', hullSize: 'FRIGATE' } };
    const event: EntityIdentityAppliedEvent = {
      sessionId: 's',
      modRoot: 'M:/mod',
      result: { ...savedWriteFixture(), identityChanges: [{ before: before.target.target, after }] },
    };
    const handler = mocks.listen.mock.calls[0]![0] as (event: EntityIdentityAppliedEvent) => Promise<void>;
    mocks.query.mockResolvedValue(next);
    mocks.retarget.mockRejectedValueOnce(new Error('native retarget'));
    await expect(handler(event)).rejects.toThrow('native retarget');
    expect(vm.joint.currentTarget.value!.id).toBe('lasher');
    await handler(event);
    expect(vm.joint.currentTarget.value!.id).toBe('renamed');
    expect(vm.panel.value!.heading[0]!.display).toBe('My name');
    expect(vm.history.canUndo.value).toBe(true);
    await vm.undo();
    expect(vm.panel.value!.heading[0]!.display).toBe('Lasher');
    expect(vm.joint.draftValue.value.spec).toMatchObject({ state: 'present', value: { hullId: 'renamed' } });
    wrapper.unmount();
  });
  it('keeps the initialized listener and releases it on unmount', async () => {
    const { vm, wrapper } = editor();
    await vm.initialize();
    await vm.initialize();
    expect(mocks.stop).toHaveBeenCalledTimes(0);
    wrapper.unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.invalidations).toHaveLength(0);
  });
  it('keeps associated sources readonly and records numeric field history without rereading references', async () => {
    const { vm, wrapper } = editor();
    await vm.initialize();
    await flushPromises();
    expect(Object.keys(vm.joint.draftValue.value)).toEqual(['spec', 'csv', 'description']);
    const field = shipPanel(vm).combat.find((stat) => stat.id === 'hitpoints')!.fields[0]!;
    vm.updateField(field, { kind: 'set', value: 1800 });
    await flushPromises();
    expect(shipPanel(vm).combat.find((stat) => stat.id === 'hitpoints')!.display).toBe('1800');
    expect(vm.history.canUndo.value).toBe(true);
    expect(mocks.projection).not.toHaveBeenCalled();
    await vm.undo();
    expect(shipPanel(vm).combat.find((stat) => stat.id === 'hitpoints')!.display).toBe('1750');
    wrapper.unmount();
  });
  it('revokes the old reference read and admits only the latest system projection', async () => {
    const { vm, wrapper } = editor();
    await vm.initialize();
    await flushPromises();
    let finish!: (value: JointEditSnapshot) => void;
    mocks.projection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const field = shipPanel(vm).system.fields[0]!;
    vm.updateField(field, { kind: 'set', value: 'first' });
    await flushPromises();
    const firstSignal = mocks.projection.mock.calls[0]![1] as AbortSignal;
    const latest = shipJointFixture();
    latest.records.find((record) => record.key === 'system-csv')!.value = {
      state: 'present',
      value: { id: 'ammofeed', name: 'Latest system' },
    };
    mocks.projection.mockResolvedValueOnce(latest);
    vm.updateField(field, { kind: 'set', value: 'second' });
    await flushPromises();
    expect(firstSignal.aborted).toBe(true);
    expect(shipPanel(vm).system.display).toBe('Latest system');
    finish(shipJointFixture());
    await flushPromises();
    expect(shipPanel(vm).system.display).toBe('Latest system');
    expect(mocks.error).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('clears the session and refuses a late association after session release', async () => {
    const { vm, wrapper } = editor();
    await vm.initialize();
    await flushPromises();
    let finish!: (value: JointEditSnapshot) => void;
    mocks.projection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vm.updateField(shipPanel(vm).system.fields[0]!, { kind: 'set', value: 'next' });
    await flushPromises();
    for (const listener of [...mocks.invalidations]) listener({ sessionId: 's', scope: 'session' });
    expect(vm.joint.currentTarget.value).toBeNull();
    expect(vm.panel.value).toBeNull();
    expect(vm.errorText.value).toBe('所属会话已关闭');
    finish(shipJointFixture());
    await flushPromises();
    expect(vm.panel.value).toBeNull();
    wrapper.unmount();
  });
});
