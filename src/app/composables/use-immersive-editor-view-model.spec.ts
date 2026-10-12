import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shipJointFixture } from '@/test/joint-edit';
import { weaponJointFixture } from '@/test/weapon-joint-edit';
import { wingJointFixture } from '@/test/wing-joint-edit';
import type { JointEditSnapshot } from '@/shared/types';
import { initializeSettingsStore } from '@/stores/settings.store';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/write-result';
import type { EntityIdentityAppliedEvent } from '@/windows/window.events';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  save: vi.fn(),
  projection: vi.fn(),
  listen: vi.fn(),
  stop: vi.fn(),
  error: vi.fn(),
  retarget: vi.fn(),
  media: vi.fn(),
  choose: vi.fn(),
  invalidations: [] as Array<(event: unknown) => void>,
  projectUpdates: [] as Array<(event: import('@/windows/window.events').ProjectSessionInvalidatedEvent) => Promise<void>>,
}));
vi.mock('@/services/joint-edit.service', () => ({
  queryJointEdit: mocks.query,
  queryJointEditRow: mocks.query,
  queryJointEditProjection: mocks.projection,
}));
vi.mock('@/app/composables/use-joint-edit-actions', () => ({ useJointEditActions: () => ({ open: mocks.query, save: mocks.save }) }));
vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({ error: mocks.error, success: vi.fn(), choose: mocks.choose }),
}));
vi.mock('@/orchestrators/entity-events.orchestrator', () => ({ listenEntityIdentityApplied: mocks.listen }));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({
  listenProjectSessionInvalidated: async (
    listener: (event: import('@/windows/window.events').ProjectSessionInvalidatedEvent) => Promise<void>,
  ) => {
    mocks.projectUpdates.push(listener);
    return () => {
      mocks.projectUpdates.splice(mocks.projectUpdates.indexOf(listener), 1);
    };
  },
  publishCommittedWrite: async () => {},
}));
vi.mock('@/orchestrators/immersive-editor.orchestrator', () => ({ retargetImmersiveWindow: mocks.retarget }));
vi.mock('@/services/source-options.service', () => ({ querySourceOptionCatalog: vi.fn() }));
vi.mock('@/services/query-cache.service', () => ({
  hasSourceInvalidation: () => false,
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
import { useImmersiveEditorViewModel } from './use-immersive-editor-view-model';

function editor(kind: 'ship' | 'weapon' | 'wing' = 'ship') {
  let vm!: ReturnType<typeof useImmersiveEditorViewModel>;
  const wrapper = mount({
    setup() {
      vm = useImmersiveEditorViewModel(
        kind === 'ship'
          ? { ...shipJointFixture().root, kind: 'ship' }
          : kind === 'weapon'
            ? { ...weaponJointFixture().root, kind: 'weapon' }
            : { ...wingJointFixture().root, kind: 'wing', rowKey: 'wing-row' },
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
  initializeSettingsStore({
    theme: 'dark',
    accent: 'blue',
    customAccent: '#3388cc',
    historyLimit: 20,
    editMode: 'smart',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
  vi.clearAllMocks();
  mocks.invalidations.length = 0;
  mocks.projectUpdates.length = 0;
  mocks.query.mockResolvedValue(shipJointFixture());
  mocks.listen.mockResolvedValue(mocks.stop);
  mocks.choose.mockResolvedValue('follow');
});

describe('wing joint source handoff', () => {
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
  it('replaces the identity listener on retry and releases it on unmount', async () => {
    const { vm, wrapper } = editor();
    await vm.initialize();
    await vm.initialize();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(2);
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
