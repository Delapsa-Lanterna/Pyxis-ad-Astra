import type * as JointEditServiceModule from '@/services/joint-edit.service';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import { editorUiStubs, nSelect } from '@/test/unit/ui-stubs';
import { weaponJointFixture } from '@/test/fixtures/joint-edit/weapon-joint-edit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shipJointFixture } from '@/test/fixtures/joint-edit/ship-joint-edit';
import { jointFixtureValues } from '@/test/fixtures/joint-edit/joint-record';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import { appLogQueue } from '@/shared/runtime/app-log-queue';
import type { AppLogEntry, AppFeedback, JointEditDraft } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  prepare: vi.fn<typeof JointEditServiceModule.prepareJointEdit>(),
  save: vi.fn<typeof JointEditServiceModule.saveJointEdit>(),
  query: vi.fn<typeof JointEditServiceModule.queryJointEdit>(),
}));
vi.mock('@/services/joint-edit.service', () => ({
  prepareJointEdit: mocks.prepare,
  saveJointEdit: mocks.save,
  queryJointEdit: mocks.query,
}));
vi.mock('@/orchestrators/json-write-confirmation.orchestrator', () => ({
  runConfirmedJsonWrite: async (_feedback: unknown, action: (options: unknown) => unknown) =>
    action({ preserveOriginalJson: true, confirmedSources: [] }),
}));
import { skinJointFixture } from '@/test/fixtures/joint-edit/skin-joint-edit';
import { openJointEditSnapshot, resolveWingReference, submitJointEdit } from './joint-edit.orchestrator';
const records: AppLogEntry[] = [];
let feedback: AppFeedback;
beforeEach(async () => {
  await appLogQueue.flush();
  vi.clearAllMocks();
  records.length = 0;
  appLogQueue.install(async (batch) => {
    records.push(...batch);
  }, vi.fn());
  feedback = {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => 'save'),
  };
});
describe('joint declared editing scope confirmation', () => {
  it.each(['disk', 'draft'] as const)('checks the final CSV content selected from a conflict: %s', async (choice) => {
    const snapshot = shipJointFixture();
    const record = snapshot.records.find((record) => record.key === 'csv')!;
    if (record.value.state !== 'present') throw new Error('CSV fixture');
    const data = record.value.value as Record<string, string>;
    const values = { csv: { state: 'present' as const, value: { ...data, hitpoints: 'bad-value' } } };
    mocks.prepare.mockResolvedValueOnce({
      snapshot,
      values,
      conflicts: [
        {
          recordKey: 'csv',
          path: ['hitpoints'],
          baseline: { state: 'present', value: '1750' },
          disk: { state: 'present', value: 'bad-value' },
          draft: { state: 'present', value: '2400' },
        },
      ],
    });
    mocks.save.mockResolvedValueOnce({
      ...savedWriteFixture(),
      content: { target: { kind: 'joint', root: snapshot.root }, value: snapshot },
    });
    const saving = submitJointEdit(
      { baseline: snapshot, values: { csv: { state: 'present', value: { ...data, hitpoints: '2400' } } } },
      feedback,
      async () => [{ recordKey: 'csv', path: ['hitpoints'], choice }],
    );
    if (choice === 'disk') {
      await expect(saving).rejects.toMatchObject({ code: 'csv.value_invalid', location: { field: 'hitpoints', rowKey: 'csv' } });
      expect(mocks.save).not.toHaveBeenCalled();
    } else {
      await saving;
      expect(mocks.save.mock.lastCall![0].values.csv).toMatchObject({ value: { hitpoints: '2400' } });
    }
  });
  it('opens the authoritative graph once while other document drafts remain independently owned', async () => {
    const snapshot = shipJointFixture();
    mocks.query.mockResolvedValue(snapshot);
    const result = await openJointEditSnapshot(snapshot.root, feedback);
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith(snapshot.root, undefined);
    expect(result).toEqual(snapshot);
    expect(result).not.toBe(snapshot);
    expect(feedback.choose).not.toHaveBeenCalled();
  });
  it.each(['mod', 'core'] as const)('resolves the actual skin from a %s variant', async (source) => {
    const graph = skinJointFixture();
    graph.bindings.variant = 'variant';
    graph.bindings.hull = 'skin';
    const variant = graph.records.find((record) => record.key === 'variant')!;
    variant.source = { ...variant.source!, source };
    mocks.query.mockResolvedValue(graph);
    expect(await resolveWingReference({ ...graph.root, kind: 'variant' }, 'hull')).toMatchObject({
      kind: 'skin',
      id: 'sarissa_custom',
      source: 'mod',
    });
    expect(await resolveWingReference({ ...graph.root, kind: 'variant' }, 'variant')).toMatchObject({
      kind: 'variant',
      id: 'sarissa_Fighter',
      source,
    });
    graph.records.find((record) => record.key === 'skin')!.value = { state: 'missing' };
    await expect(resolveWingReference(graph.root, 'hull')).rejects.toThrow('找不到联队引用的船体');
  });
  it('confirms only submitted records while associated Core and shared sources remain readonly', async () => {
    const snapshot = shipJointFixture();
    const associated = snapshot.records.find((record) => record.key === 'system')!;
    associated.source = { ...associated.source!, source: 'core' };
    associated.referencedBy = ['one', 'two'];
    const draft: JointEditDraft = { baseline: snapshot, values: jointFixtureValues(snapshot) };
    mocks.prepare.mockResolvedValue({ snapshot, values: draft.values, conflicts: [] });
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), content: { target: { kind: 'joint', root: snapshot.root }, value: snapshot } });
    await submitJointEdit(draft, feedback, async () => []);
    expect(feedback.choose).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls[0]![0].values).not.toHaveProperty('system');
  });
  it('preserves an unchanged Core override intent and cancels without writing', async () => {
    const snapshot = shipJointFixture();
    snapshot.records.find((record) => record.key === 'spec')!.source = { ...snapshot.records[0]!.source!, source: 'core' };
    const draft = { baseline: snapshot, values: jointFixtureValues(snapshot) };
    mocks.prepare.mockResolvedValue({ snapshot, values: draft.values, conflicts: [] });
    vi.mocked(feedback.choose).mockResolvedValueOnce(null);
    expect(await submitJointEdit(draft, feedback, async () => [], ['spec'])).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), content: { target: { kind: 'joint', root: snapshot.root }, value: snapshot } });
    await submitJointEdit(draft, feedback, async () => [], ['spec']);
    expect(mocks.save.mock.calls[0]![0].createOverrides).toEqual(['spec']);
    await appLogQueue.flush();
    expect(records.filter((entry) => entry.code === 'joint.targets_decided').map((entry) => entry.fields?.status)).toEqual([
      'cancelled',
      'confirmed',
    ]);
    expect(records.find((entry) => entry.code === 'joint.targets_submitted')!.fields?.requestId).toBe(mocks.save.mock.calls[0]![1]!.id);
  });
});

describe('joint local identity presence', () => {
  it.each([
    [false, false],
    [true, true],
    [false, true],
    [true, false],
  ])('saves local presence %s -> %s after conflict choice', async (beforeId, afterId) => {
    const snapshot = shipJointFixture();
    const record = snapshot.records.find((item) => item.key === 'spec')!;
    record.value = { state: 'present', value: beforeId ? { hullId: 'sample' } : {} };
    const values: JointEditDraft['values'] = {
      spec: { state: 'present' as const, value: afterId ? { hullId: 'sample', hullName: 'Saved' } : { hullName: 'Saved' } },
    };
    mocks.prepare.mockResolvedValue({ snapshot, values, conflicts: [] });
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), content: { target: { kind: 'joint', root: snapshot.root }, value: snapshot } });
    expect(await submitJointEdit({ baseline: snapshot, values }, feedback, async () => [])).not.toBeNull();
    expect(feedback.choose).toHaveBeenCalledTimes(Number(beforeId !== afterId));
    expect(mocks.save.mock.lastCall![0].values).toEqual(values);
    if (beforeId !== afterId) {
      vi.mocked(feedback.choose).mockResolvedValueOnce('cancel');
      const count = mocks.save.mock.calls.length;
      expect(await submitJointEdit({ baseline: snapshot, values }, feedback, async () => [])).toBeNull();
      expect(mocks.save).toHaveBeenCalledTimes(count);
    }
  });
});
describe('merged weapon override review', () => {
  it.each([null, 'projectile', 'beam'] as const)('settles the branch and all shared effects once: %s', async (branch) => {
    const snapshot = weaponJointFixture(),
      record = snapshot.records[0]!;
    record.source = { ...record.source!, source: 'core' };
    record.value = { state: 'present', value: { id: snapshot.root.id, specClass: 'pulse', custom: 'retained' } };
    record.referencedBy = ['assembly-a', 'assembly-b'];
    const values = { spec: record.value };
    mocks.prepare.mockResolvedValue({ snapshot, values, conflicts: [] });
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), content: { target: { kind: 'joint', root: snapshot.root }, value: snapshot } });
    vi.mocked(feedback.choose).mockImplementationOnce(async (options) => {
      const body = mount(
        { render: () => h('div', [typeof options.content === 'function' ? options.content() : options.content]) },
        { global: { stubs: { ...editorUiStubs, Select: nSelect } } },
      );
      expect(body.text()).toContain(record.source!.path);
      expect(body.text()).toContain('assembly-a');
      expect(body.text()).toContain('assembly-b');
      expect(options.choices[0]!.label).toBe('创建本地覆盖');
      if (branch) await body.get('select').setValue(JSON.stringify(branch));
      body.unmount();
      return branch ? 'save' : null;
    });
    await submitJointEdit({ baseline: snapshot, values }, feedback, async () => [], ['spec']);
    expect(feedback.choose).toHaveBeenCalledOnce();
    if (branch) expect(mocks.save.mock.lastCall![0].values.spec).toMatchObject({ value: { specClass: branch, custom: 'retained' } });
    else expect(mocks.save).not.toHaveBeenCalled();
    expect(record.value).toMatchObject({ value: { specClass: 'pulse' } });
  });
});
