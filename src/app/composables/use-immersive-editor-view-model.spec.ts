import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shipJointFixture } from '@/test/joint-edit';
import type { JointEditSnapshot } from '@/shared/types';
import { initializeSettingsStore } from '@/stores/settings.store';
import { savedWriteFixture } from '@/test/write-result';
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
  invalidations: [] as Array<(event: unknown) => void>,
}));
vi.mock('@/services/joint-edit.service', () => ({
  queryJointEdit: mocks.query,
  queryJointEditRow: mocks.query,
  queryJointEditProjection: mocks.projection,
}));
vi.mock('@/app/composables/use-joint-edit-actions', () => ({ useJointEditActions: () => ({ open: mocks.query, save: mocks.save }) }));
vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({ error: mocks.error, success: vi.fn(), choose: async () => 'follow' }),
}));
vi.mock('@/orchestrators/entity-events.orchestrator', () => ({ listenEntityIdentityApplied: mocks.listen }));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({
  listenProjectSessionInvalidated: async () => () => {},
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

function editor() {
  let vm!: ReturnType<typeof useImmersiveEditorViewModel>;
  const wrapper = mount({
    setup() {
      vm = useImmersiveEditorViewModel(shipJointFixture().root);
      return () => null;
    },
  });
  return { vm, wrapper };
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
  mocks.query.mockResolvedValue(shipJointFixture());
  mocks.listen.mockResolvedValue(mocks.stop);
});
describe('immersive ship lifecycle and reference channels', () => {
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
    vm.updateField(vm.panel.value!.system.fields[0]!, { kind: 'set', value: 'next' });
    await flushPromises();
    expect(vm.panel.value!.system.display).toBe('Selected system');
    const actual = shipJointFixture();
    actual.records[1]!.value = { state: 'present', value: { 'system id': 'next', id: 'lasher', name: 'Lasher' } };
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), refreshedEntity: actual });
    await vm.save();
    await flushPromises();
    expect(mocks.projection).toHaveBeenCalledTimes(2);
    expect(vm.panel.value!.system.display).toBe('Selected system');
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
    const field = vm.panel.value!.combat.find((stat) => stat.id === 'hitpoints')!.fields[0]!;
    vm.updateField(field, { kind: 'set', value: 1800 });
    await flushPromises();
    expect(vm.panel.value!.combat.find((stat) => stat.id === 'hitpoints')!.display).toBe('1800');
    expect(vm.history.canUndo.value).toBe(true);
    expect(mocks.projection).not.toHaveBeenCalled();
    await vm.undo();
    expect(vm.panel.value!.combat.find((stat) => stat.id === 'hitpoints')!.display).toBe('1750');
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
    const field = vm.panel.value!.system.fields[0]!;
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
    expect(vm.panel.value!.system.display).toBe('Latest system');
    finish(shipJointFixture());
    await flushPromises();
    expect(vm.panel.value!.system.display).toBe('Latest system');
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
    vm.updateField(vm.panel.value!.system.fields[0]!, { kind: 'set', value: 'next' });
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
