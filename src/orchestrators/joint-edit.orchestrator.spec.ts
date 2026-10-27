import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shipJointFixture } from '@/test/fixtures/joint-edit/ship-joint-edit';
import { jointFixtureValues } from '@/test/fixtures/joint-edit/joint-record';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import type { AppFeedback, JointEditDraft } from '@/shared/types';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), save: vi.fn(), query: vi.fn() }));
vi.mock('@/services/joint-edit.service', () => ({
  prepareJointEdit: mocks.prepare,
  saveJointEdit: mocks.save,
  queryJointEdit: mocks.query,
}));
vi.mock('@/orchestrators/edit-target-handoff.orchestrator', () => ({
  withEditTargetHandoff: async (_targets: unknown, _feedback: unknown, action: () => unknown) => action(),
}));
vi.mock('@/orchestrators/json-write-confirmation.orchestrator', () => ({
  runConfirmedJsonWrite: async (_feedback: unknown, action: (options: unknown) => unknown) =>
    action({ preserveOriginalJson: true, confirmedSources: [] }),
}));
import { skinJointFixture } from '@/test/fixtures/joint-edit/skin-joint-edit';
import { resolveWingReference, submitJointEdit } from './joint-edit.orchestrator';
let feedback: AppFeedback;
beforeEach(() => {
  vi.clearAllMocks();
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
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), refreshedEntity: snapshot });
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
    expect(await submitJointEdit(draft, feedback, async () => [], undefined, undefined, ['spec'])).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), refreshedEntity: snapshot });
    await submitJointEdit(draft, feedback, async () => [], undefined, undefined, ['spec']);
    expect(mocks.save.mock.calls[0]![0].createOverrides).toEqual(['spec']);
  });
});
