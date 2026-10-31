import { savedWriteFixture } from '@/test/fixtures/write-result';
import { projectChangeFixture, savedContentWorks } from '@/test/unit/project-changes';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h, computed, effectScope } from 'vue';
import { useSpecEditorDraftImages } from './use-spec-editor-draft-images';
import { useSpecWeaponEditorDependencies } from './weapon/use-spec-weapon-editor-dependencies';
import { specEditorDefinitions } from '../spec-editor-assembly';
import { createPinia, setActivePinia } from 'pinia';
import SpecShipEditor from '@/app/components/spec-editor/ship/SpecShipEditor.vue';
import SpecWeaponEditor from '@/app/components/spec-editor/weapon/SpecWeaponEditor.vue';
import { installCanvas2DStub } from '@/test/unit/canvas-stub';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { editorUiStubs } from '@/test/unit/ui-stubs';

import type { SpecEditorData, SpecEditorKind, WriteResult, RowData } from '@/shared/types/index';
import * as projectSync from '@/orchestrators/project-sync.orchestrator';
import { committedChangeFixture, dispatchProjectChangeFixture } from '@/test/unit/project-changes';

vi.mock('@/services/window.service', () => ({ releaseNativeWindowTargets: vi.fn(async () => {}) }));
const mocks = vi.hoisted(() => ({
  identityHandler: null as null | ((event: import('@/shared/types').CommittedWriteEvent) => Promise<void>),
  querySpecEditorData: vi.fn(),
  saveSpecEditorSpecByKind: vi.fn(),
  loadSpecEditorImport: vi.fn(),
  refreshBundleResources: vi.fn(),
  queryDraftEditorImages: vi.fn(),
  publishCommittedWrite: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  pickEditorSpecFile: vi.fn(async () => null as string | null),
  closeCurrentWindow: vi.fn(async () => {}),
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null as string | null),
  },
}));

vi.mock('@/services/spec-editor.service', () => ({
  loadSpecEditorImport: mocks.loadSpecEditorImport,
  saveSpecEditorSpecByKind: mocks.saveSpecEditorSpecByKind,
}));
vi.mock('@/services/spec-ship-editor.service', () => ({
  querySpecShipEditorData: vi.fn(),
  querySpecShipEditorImages: (session: string, id: string, draft: RowData, signal: AbortSignal) =>
    mocks.queryDraftEditorImages(session, 'ship', id, draft, signal),
}));
vi.mock('@/services/spec-system-editor.service', () => ({ querySpecSystemEditorData: vi.fn() }));
vi.mock('@/services/spec-weapon-editor.service', () => ({
  querySpecWeaponEditorData: vi.fn(),
  querySpecWeaponEditorImages: (session: string, id: string, draft: RowData, signal: AbortSignal) =>
    mocks.queryDraftEditorImages(session, 'weapon', id, draft, signal),
}));
vi.mock('@/services/spec-projectile-editor.service', () => ({ querySpecProjectileEditorData: vi.fn() }));
vi.mock('@/orchestrators/entity-identity.orchestrator', () => ({
  chooseIdentityFilename: vi.fn(async () => false),
  reserveEntityIntent: async (
    _session: string,
    _root: string,
    source: import('@/shared/types/index').EntityEditTarget,
    draft: RowData,
  ) => ({
    source,
    nextId: draft.hullId ?? draft.id,
    destinationVersion: { path: source.write.path, fingerprint: 'destination' },
    nextWrite: source.write,
  }),
  retargetEntityWindow: vi.fn(async () => {}),
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({
  ...(await import('@/test/unit/project-changes')),
  beginSavedWrite: (await import('@/test/unit/project-changes')).withSavedCompletion((value) => {
    const snapshot = value as { target: { modRoot: string; sessionId: string | null }; meta: { receipt: unknown } };
    return mocks.publishCommittedWrite(snapshot.target.modRoot, snapshot.meta.receipt, snapshot.target.sessionId);
  }),
  publishCommittedWrite: mocks.publishCommittedWrite,
  listenSavedIdentity: vi.fn(async (handler) => {
    mocks.identityHandler = handler;
    return () => {};
  }),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

vi.mock('@/orchestrators/json-write-confirmation.orchestrator', () => ({
  runConfirmedJsonWrite: (_feedback: unknown, write: (options: unknown) => Promise<unknown>) =>
    write({ preserveOriginalJson: true, confirmedSources: [] }),
}));

vi.mock('@/shared/runtime/dialog.runtime', () => ({
  pickEditorSpecFile: mocks.pickEditorSpecFile,
  pickImageFileDialog: vi.fn(async () => null),
  pickFileDialog: vi.fn(async () => null),
}));

vi.mock('@/windows/current.window', () => ({
  closeCurrentWindow: mocks.closeCurrentWindow,
}));

import { useSpecEditorWindowViewModel } from './use-spec-editor-window-view-model';
import { createShipSpec, createSystemSpec } from '@/domain/editors/spec-construction';
import { createWeaponSpec } from '@/domain/editors/weapon-spec';
import { createProjectileSpec } from '@/domain/spec-editor/projectile/spec-projectile-model';
import { formatError } from '@/shared/lib/errors';
import { useSaveCommandStore } from '@/stores/save-command.store';

function shipBundleFixture(isNew = false): SpecEditorData<'ship'> {
  return {
    baseVersions: [],
    target: entityTargetFixture('ship', 'XY', isNew ? 'create' : 'existing'),
    kind: 'ship',
    spec: { hullId: 'XY', hullName: 'Test Ship' },
    isNew,
  };
}

function writeResultFixture(refreshedEntity: RowData = { hullId: 'XY' }): WriteResult {
  return {
    ...savedWriteFixture(),
    identityChanges: [{ before: entityTargetFixture('ship', 'XY'), after: entityTargetFixture('ship', 'XY') }],
    content: { target: { kind: 'spec', target: entityTargetFixture('ship', 'XY') }, value: refreshedEntity },
  };
}

function savedSpecChange(event: {
  kind: SpecEditorKind;
  sessionId: string;
  modRoot: string;
  id: string;
  spec: RowData;
  writeResult?: WriteResult;
}) {
  const target = entityTargetFixture(event.kind, event.id, 'existing', event.modRoot);
  const result = {
    ...(event.writeResult ?? writeResultFixture()),
    content: { target: { kind: 'spec' as const, target }, value: event.spec },
    baseVersions: event.writeResult?.baseVersions.length
      ? event.writeResult.baseVersions
      : [{ path: target.write.path, fingerprint: 'saved' }],
  };
  return dispatchProjectChangeFixture(committedChangeFixture(result, event.sessionId, event.modRoot));
}
const releases: Array<() => void> = [];
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  mocks.queryDraftEditorImages.mockImplementation(async (_session: string, kind: string, _id: string, draft: RowData) => {
    const field = kind === 'ship' ? 'spriteName' : 'turretSprite';
    const path = draft[field];
    return {
      resourceRefs: path ? [{ source: 'mod', ownerKind: kind, ownerId: 'XY', key: kind === 'ship' ? 'sprite' : field, relPath: path }] : [],
      spriteData: kind === 'ship' ? (path ?? '') : path ? { [field]: path } : {},
    };
  });
});
afterEach(() => {
  releases.splice(0).forEach((dispose) => dispose());
});

function createViewModel(kind: SpecEditorKind = 'ship', validate = false) {
  const scope = effectScope();
  const result = scope.run(() => {
    const definition = specEditorDefinitions[kind];
    const vm = useSpecEditorWindowViewModel(
      { sessionId: 's1', modRoot: 'M:/mod', id: 'XY', kind },
      {
        ...definition,
        validate: validate ? definition.validate : undefined,
        read: (session, id, signal) => mocks.querySpecEditorData(session, kind, id, signal),
      },
    );
    const images =
      kind === 'ship'
        ? useSpecEditorDraftImages<string>({
            target: vm.currentTarget,
            draft: vm.draftValue,
            context: vm.editContext,
            fields: ['spriteName'],
            query: (session, id, draft, signal) => mocks.queryDraftEditorImages(session, kind, id, draft, signal),
          })
        : null;
    const weapon =
      kind === 'weapon'
        ? useSpecWeaponEditorDependencies({ target: vm.currentTarget, draft: vm.draftValue, context: vm.editContext })
        : null;
    return {
      ...vm,
      spriteData: computed<string | Record<string, string>>(() => images?.value.value?.spriteData ?? weapon?.spriteData.value ?? {}),
      imageRefs: computed(() => images?.value.value?.resourceRefs ?? []),
      disposeEditorWindow: () => {
        weapon?.dispose();
        images?.dispose();
        vm.disposeEditorWindow();
        scope.stop();
      },
    };
  })!;
  releases.push(result.disposeEditorWindow);
  return result;
}
async function initializedViewModel(kind: SpecEditorKind = 'ship', bundle: SpecEditorData = shipBundleFixture()) {
  mocks.querySpecEditorData.mockResolvedValue(bundle);
  const viewModel = createViewModel(kind);
  await viewModel.initializeEditorWindow();
  await vi.waitFor(() => expect(viewModel.editorData.value).not.toBeNull());
  return viewModel;
}

describe('useSpecEditorWindowViewModel save gating', () => {
  it('can retry the same identity receipt after a failed authoritative read', async () => {
    const vm = await initializedViewModel();
    const next = { ...shipBundleFixture(), target: entityTargetFixture('ship', 'next'), spec: { hullId: 'next', hullName: 'Renamed' } };
    const result = writeResultFixture();
    result.identityChanges = [{ before: entityTargetFixture('ship', 'XY'), after: next.target }];

    mocks.querySpecEditorData.mockRejectedValueOnce(new Error('read failed'));
    await expect(
      mocks.identityHandler!({ originWindowLabel: 'peer', reason: 'save', sessionId: 's1', modRoot: 'M:/mod', result }),
    ).rejects.toThrow('read failed');
    expect(vm.currentTarget.value?.id).toBe('XY');
    mocks.querySpecEditorData.mockResolvedValueOnce(next);
    await mocks.identityHandler!({ originWindowLabel: 'peer', reason: 'save', sessionId: 's1', modRoot: 'M:/mod', result });
    expect(vm.currentTarget.value?.id).toBe('next');
    expect(vm.editorData.value?.spec.hullId).toBe('next');
  });
  it('keeps an unconfirmed rename unfinished while retaining its draft', async () => {
    const vm = await initializedViewModel();
    vm.updateEditorDraft({ hullId: 'XY', hullName: 'Draft' });
    mocks.feedback.choose.mockResolvedValueOnce(null);
    const result = writeResultFixture();
    result.identityChanges = [{ before: entityTargetFixture('ship', 'XY'), after: entityTargetFixture('ship', 'next') }];
    await expect(mocks.identityHandler!(committedChangeFixture(result, 's1', 'M:/mod'))).rejects.toMatchObject({
      code: 'write.identity_pending',
    });
    expect(vm.draftValue.value).toEqual({ hullId: 'XY', hullName: 'Draft' });
  });

  it('accepts a dirty identity handoff while preserving the draft and raw inputs', async () => {
    const vm = await initializedViewModel();
    vm.updateEditorDraft({ hullId: 'XY', hullName: 'Local' });
    mocks.feedback.choose.mockResolvedValueOnce('follow');
    const next = { ...shipBundleFixture(), target: entityTargetFixture('ship', 'next'), spec: { hullId: 'next', hullName: 'External' } };
    mocks.querySpecEditorData.mockResolvedValueOnce(next);
    const result = writeResultFixture();
    result.identityChanges = [{ before: entityTargetFixture('ship', 'XY'), after: next.target }];

    await mocks.identityHandler!({ originWindowLabel: 'peer', reason: 'save', sessionId: 's1', modRoot: 'm:/MOD/', result });
    expect(vm.currentTarget.value?.id).toBe('next');
    expect(vm.draftValue.value).toEqual({ hullId: 'next', hullName: 'Local' });
    expect(vm.editorData.value?.spec).toEqual({ hullId: 'next', hullName: 'Local' });
    expect(vm.draftDirty.value).toBe(true);
    expect(vm.editContext.value?.handoff).toBe('external');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.feedback.choose.mockResolvedValue(null);
  });

  it('keeps save available for loaded specs so each click can check or retry', async () => {
    const viewModel = await initializedViewModel();
    expect(viewModel.editorData.value).not.toBeNull();
    expect(viewModel.canSaveSpec.value).toBe(true);

    viewModel.updateEditorDraft({ hullId: 'XY', hullName: 'Edited' });
    expect(viewModel.draftDirty.value).toBe(true);
    expect(viewModel.canSaveSpec.value).toBe(true);
  });

  it('enables the save for new specs even before edits', async () => {
    const viewModel = await initializedViewModel('ship', shipBundleFixture(true));
    expect(viewModel.canSaveSpec.value).toBe(true);
  });
});

describe('Spec common save checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.feedback.choose.mockResolvedValue(null);
  });
  async function openChecked(kind: SpecEditorKind) {
    const spec =
      kind === 'ship'
        ? { ...createShipSpec('XY'), spriteName: 'graphics/sample.png', moduleAnchor: [0, 0] }
        : kind === 'weapon'
          ? {
              ...createWeaponSpec('XY', 'projectile'),
              turretSprite: 'graphics/sample.png',
              hardpointSprite: 'graphics/sample.png',
              projectileSpecId: 'sample',
            }
          : kind === 'projectile'
            ? createProjectileSpec('XY')
            : createSystemSpec('XY');
    const target = entityTargetFixture(kind, 'XY');
    mocks.querySpecEditorData.mockResolvedValue({
      kind,
      target,
      spec,
      baseVersions: [{ path: target.write.path, fingerprint: 'loaded' }],
      isNew: false,
    });
    const vm = createViewModel(kind, true);
    await vm.initializeEditorWindow();
    mocks.saveSpecEditorSpecByKind.mockImplementation(async (_session, _root, _target, draft) => ({
      ...writeResultFixture(draft),
      identityChanges: [{ before: target, after: target }],
    }));
    return vm;
  }
  it.each(['ship', 'weapon', 'projectile', 'system'] as const)(
    'shares all content errors before %s saving and clears them after correction',
    async (kind) => {
      const vm = await openChecked(kind);
      const original = vm.draftValue.value;
      const key = kind === 'ship' ? 'width' : kind === 'weapon' ? 'turretOffsets' : kind === 'projectile' ? 'width' : 'type';
      vm.updateEditorDraft({ ...original, [key]: kind === 'weapon' ? [] : 'invalid' });
      expect(vm.problems.issues.value.some((issue) => issue.path === key)).toBe(true);
      await vm.saveEditorData();
      expect(mocks.saveSpecEditorSpecByKind).not.toHaveBeenCalled();
      expect(formatError(mocks.feedback.error.mock.calls.at(-1)![0])).toBe('请先解决顶部错误后再保存');
      vm.updateEditorDraft(original);
      expect(vm.problems.issues.value).toEqual([]);
      await vm.saveEditorData();
      expect(mocks.saveSpecEditorSpecByKind).toHaveBeenCalledTimes(1);
    },
  );
  it('confirms warnings for every save including the coordinated participant', async () => {
    const vm = await openChecked('system');
    const stop = vm.problems.register(() => [{ severity: 'warning', code: 'fixture.warning', path: 'range', message: '请确认范围' }]);
    await vm.saveEditorData();
    expect(mocks.saveSpecEditorSpecByKind).not.toHaveBeenCalled();
    mocks.feedback.choose.mockResolvedValue('save');
    const participant = useSaveCommandStore().participantsForTargets([
      { sessionId: 's1', modRoot: 'M:/mod', path: entityTargetFixture('system', 'XY').write.path },
    ])[0]!;
    await vm.saveEditorData();
    await participant.editing!.save();
    expect(mocks.feedback.choose).toHaveBeenCalledTimes(3);
    expect(mocks.saveSpecEditorSpecByKind).toHaveBeenCalledTimes(2);
    expect(participant).toBeDefined();
    stop();
  });
  it('keeps confirmed contents while later draft edits remain independent', async () => {
    const vm = await openChecked('system');
    vm.problems.register(() => [
      { severity: 'warning', code: 'fixture.warning', path: 'range', message: String(vm.draftValue.value.range) },
    ]);
    let confirm!: (value: string) => void;
    mocks.feedback.choose.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          confirm = resolve;
        }),
    );
    const saving = vm.saveEditorData();
    await flushPromises();
    vm.updateEditorDraft({ ...vm.draftValue.value, range: 25 });
    mocks.feedback.choose.mockResolvedValue('save');
    confirm('save');
    await saving;
    expect(mocks.feedback.choose).toHaveBeenCalledOnce();
    expect(mocks.saveSpecEditorSpecByKind.mock.lastCall?.[3]).not.toHaveProperty('range', 25);
    expect(vm.draftValue.value.range).toBe(25);
  });
  it('keeps actual write errors at the top and retries them through save', async () => {
    const vm = await openChecked('system');
    mocks.saveSpecEditorSpecByKind.mockRejectedValueOnce(new Error('write failed'));
    await vm.saveEditorData();
    expect(vm.problems.issues.value).toMatchObject([{ severity: 'error', message: 'write failed' }]);
    await vm.saveEditorData();
    expect(mocks.saveSpecEditorSpecByKind).toHaveBeenCalledTimes(2);
    expect(vm.problems.issues.value).toEqual([]);
  });
  it('retries failed content processing independently of the next save', async () => {
    const vm = await openChecked('system');
    mocks.publishCommittedWrite.mockRejectedValueOnce(new Error('publish failed'));
    await vm.saveEditorData();
    await expect(savedContentWorks.at(-1)!.content).rejects.toThrow('publish failed');
    await savedContentWorks.at(-1)!.retryContent();
    expect(mocks.saveSpecEditorSpecByKind).toHaveBeenCalledTimes(1);
    expect(vm.problems.issues.value).toEqual([]);
    await vm.saveEditorData();
    expect(mocks.saveSpecEditorSpecByKind).toHaveBeenCalledTimes(2);
  });
});

describe('useSpecEditorWindowViewModel saving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.feedback.choose.mockResolvedValue(null);
  });

  it.each(['ship', 'weapon'] as const)('refreshes %s draft images and discards an older response', async (kind) => {
    const resource = {
      source: 'mod' as const,
      relPath: 'graphics/old.png',
      ownerKind: kind,
      ownerId: 'XY',
      key: kind === 'ship' ? 'sprite' : 'turretSprite',
    };
    const bundle =
      kind === 'ship'
        ? {
            ...shipBundleFixture(),
            spec: { hullId: 'XY', spriteName: 'graphics/old.png' },
            resourceRefs: [resource],
            shipSpriteData: 'old',
          }
        : {
            kind,
            baseVersions: [],
            isNew: false,
            spec: { id: 'XY', turretSprite: 'graphics/old.png' },
            weaponCsvRow: {},
            projectileSpecs: {},
            resourceRefs: [resource],
            weaponSpriteData: { turretSprite: 'old' },
          };
    mocks.querySpecEditorData.mockResolvedValue(bundle);
    const vm = createViewModel(kind);
    await vm.initializeEditorWindow();
    await vi.waitFor(() => expect(vm.loading.value).toBe(false));
    const releases: Array<(images: unknown) => void> = [];
    mocks.queryDraftEditorImages.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }),
    );
    const draft = (path: string): RowData => (kind === 'ship' ? { hullId: 'XY', spriteName: path } : { id: 'XY', turretSprite: path });
    vm.updateEditorDraft(draft('graphics/first.png'));
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    vm.updateEditorDraft(draft('graphics/latest.png'));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!({
      resourceRefs: [{ ...resource, relPath: 'graphics/latest.png' }],
      spriteData: kind === 'ship' ? 'latest' : { turretSprite: 'latest' },
    });
    await vi.waitFor(() =>
      expect(typeof vm.spriteData.value === 'string' ? vm.spriteData.value : vm.spriteData.value.turretSprite).toBe('latest'),
    );
    releases[0]!({
      resourceRefs: [{ ...resource, relPath: 'graphics/first.png' }],
      spriteData: kind === 'ship' ? 'first' : { turretSprite: 'first' },
    });
    await Promise.resolve();
    expect(typeof vm.spriteData.value === 'string' ? vm.spriteData.value : vm.spriteData.value.turretSprite).toBe('latest');
    vm.disposeEditorWindow();
  });

  it('writes the draft, broadcasts the saved event and commits the base', async () => {
    const result = writeResultFixture({ hullId: 'XY', hullName: 'Saved Name' });
    mocks.saveSpecEditorSpecByKind.mockResolvedValue(result);
    const viewModel = await initializedViewModel();

    viewModel.updateEditorDraft({ hullId: 'XY', hullName: 'Saved Name' });
    await viewModel.saveEditorData();

    expect(mocks.saveSpecEditorSpecByKind).toHaveBeenCalledWith(
      's1',
      'M:/mod',
      entityTargetFixture('ship', 'XY'),
      { hullId: 'XY', hullName: 'Saved Name' },
      { preserveOriginalJson: true, confirmedSources: [] },
      [{ path: 'M:/mod/data/hulls/XY.ship', fingerprint: 'destination' }],
      expect.any(Object),
      undefined,
    );
    expect(mocks.publishCommittedWrite).toHaveBeenCalledWith('M:/mod', result, 's1');
    expect(mocks.feedback.success).toHaveBeenCalledWith('XY 已保存');
    expect(viewModel.draftDirty.value).toBe(false);
    expect(viewModel.canSaveSpec.value).toBe(true);
  });

  it.each(['projectile', 'system'] as const)(
    'keeps %s edits made during saving and accepts its external baseline explicitly',
    async (kind) => {
      const target = entityTargetFixture(kind, 'XY');
      const original = { id: 'XY', custom: 'original' };
      const vm = await initializedViewModel(kind, { kind, target, spec: original, baseVersions: [], isNew: false });
      let release!: (result: WriteResult) => void;
      mocks.saveSpecEditorSpecByKind.mockImplementationOnce(
        () =>
          new Promise<WriteResult>((resolve) => {
            release = resolve;
          }),
      );
      const submitted = { ...original, custom: 'submitted' };
      vm.updateEditorDraft(submitted);
      const saving = vm.saveEditorData();
      await flushPromises();
      vm.updateEditorDraft({ ...original, custom: 'later' });
      const result = { ...writeResultFixture(submitted), identityChanges: [{ before: target, after: target }] };
      release(result);
      await saving;
      expect(mocks.saveSpecEditorSpecByKind.mock.lastCall?.slice(0, 4)).toEqual(['s1', 'M:/mod', target, submitted]);
      expect(vm.draftValue.value.custom).toBe('later');
      expect(vm.editorData.value?.spec).toBe(vm.draftValue.value);
      expect(vm.draftDirty.value).toBe(true);
      const external = { ...original, custom: 'external' };
      void savedSpecChange({
        kind,
        sessionId: 's1',
        modRoot: 'M:/mod',
        id: 'XY',
        spec: external,
        writeResult: {
          ...result,

          content: { target: { kind: 'spec', target: entityTargetFixture('ship', 'XY') }, value: external },
        },
      });
      expect(vm.draftValue.value.custom).toBe('later');
      vm.loadPendingExternalSpec();
      mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
      expect(vm.draftValue.value).toEqual(external);
      expect(vm.editorData.value?.spec).toBe(vm.draftValue.value);
      expect(vm.draftDirty.value).toBe(false);
    },
  );

  it('reports save failures and keeps the draft editable', async () => {
    mocks.saveSpecEditorSpecByKind.mockRejectedValue(new Error('write denied'));
    const viewModel = await initializedViewModel();
    viewModel.updateEditorDraft({ hullId: 'XY' });
    await viewModel.saveEditorData();
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
    expect(viewModel.draftDirty.value).toBe(true);
  });

  it('keeps the loaded spec credential when preparation queries the same destination again', async () => {
    const bundle = shipBundleFixture();
    const baseVersions = [{ path: bundle.target.write.path, fingerprint: 'loaded-spec' }];
    mocks.saveSpecEditorSpecByKind.mockResolvedValue(writeResultFixture({ hullId: 'XY', hullName: 'Saved' }));
    const vm = await initializedViewModel('ship', { ...bundle, baseVersions });
    vm.updateEditorDraft({ hullId: 'XY', hullName: 'Saved' });
    await vm.saveEditorData();
    expect(mocks.saveSpecEditorSpecByKind.mock.lastCall?.[5]).toEqual(baseVersions);
  });

  it('preserves the weapon draft when a projectile is saved and its catalogue refreshes', async () => {
    const weapon = { id: 'XY', projectileSpecId: 'A', turretSprite: 'image.png' };
    mocks.querySpecEditorData.mockResolvedValue({
      kind: 'weapon',
      target: entityTargetFixture('weapon', 'XY'),
      baseVersions: [],
      isNew: false,
      spec: weapon,
    });
    const vm = createViewModel('weapon');
    await vm.initializeEditorWindow();
    await flushPromises();
    vm.updateEditorDraft({ ...weapon, projectileSpecId: 'B' });
    void projectChangeFixture('s1', {
      paths: [],
      tables: [],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'entity-list', entity: { kind: 'projectile', id: null }, table: null, source: null, resource: null }],
    });
    await flushPromises();
    expect(vm.draftValue.value).toEqual({ ...weapon, projectileSpecId: 'B' });
    expect(vm.draftDirty.value).toBe(true);
    expect(vm.spriteData.value).toEqual({ turretSprite: 'image.png' });
  });

  it('releases a listener whose registration completes after disposal', async () => {
    let release!: (stop: () => void) => void;
    const stop = vi.fn();
    vi.spyOn(projectSync, 'listenSavedContent').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const vm = createViewModel();
    const initializing = vm.initializeEditorWindow();
    await flushPromises();
    vm.disposeEditorWindow();
    release(stop);
    await initializing;
    expect(stop).toHaveBeenCalledOnce();
    expect(mocks.querySpecEditorData).not.toHaveBeenCalled();
  });

  it('accepts canonical content before broadcast failure and recognizes its later echo', async () => {
    const vm = await initializedViewModel('ship', shipBundleFixture(true));
    const result = writeResultFixture({ hullId: 'XY', hullName: 'Canonical' });
    result.requestId = 'captured-save';
    mocks.saveSpecEditorSpecByKind.mockResolvedValueOnce(result);
    mocks.publishCommittedWrite.mockRejectedValueOnce(new Error('broadcast failed'));
    vm.updateEditorDraft({ hullId: 'XY', hullName: 'Raw' });
    const writing = vm.saveEditorData();
    const waiting = vm.waitForSave();
    await writing;
    expect(await waiting).toBe(true);
    await expect(savedContentWorks.at(-1)!.content).rejects.toThrow('broadcast failed');
    expect(vm.draftValue.value).toEqual(result.content?.value);
    expect(vm.editorData.value?.isNew).toBe(false);
    expect(vm.draftDirty.value).toBe(false);
    await savedContentWorks.at(-1)!.retryContent();
    expect(mocks.saveSpecEditorSpecByKind).toHaveBeenCalledOnce();
    vm.updateEditorDraft({ hullId: 'XY', hullName: 'Later' });
    await savedSpecChange({
      kind: 'ship',
      sessionId: 's1',
      modRoot: 'M:/mod',
      id: 'XY',
      spec: result.content!.value,
      writeResult: result,
    });
    expect(vm.draftValue.value.hullName).toBe('Later');
    expect(vm.externalUpdateNotice.value).toBe('');
  });

  it('ignores concurrent saves while one is in flight', async () => {
    let resolveSave: (value: WriteResult) => void = () => {};
    mocks.saveSpecEditorSpecByKind.mockImplementation(
      () =>
        new Promise<WriteResult>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const viewModel = await initializedViewModel();
    viewModel.updateEditorDraft({ hullId: 'XY' });
    const first = viewModel.saveEditorData();
    const second = viewModel.saveEditorData();
    await flushPromises();
    resolveSave(writeResultFixture());
    await Promise.all([first, second]);
    expect(mocks.saveSpecEditorSpecByKind).toHaveBeenCalledTimes(1);
  });
});

describe('useSpecEditorWindowViewModel missing specs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('closes the window when the user cancels the missing-spec prompt', async () => {
    mocks.querySpecEditorData.mockResolvedValue(shipBundleFixture(true));
    mocks.feedback.choose.mockResolvedValue(null);
    const viewModel = createViewModel();
    await viewModel.initializeEditorWindow();
    await vi.waitFor(() => expect(mocks.closeCurrentWindow).toHaveBeenCalledTimes(1));
    viewModel.disposeEditorWindow();
  });

  it('imports an existing file for a missing spec', async () => {
    mocks.querySpecEditorData.mockResolvedValue(shipBundleFixture(true));
    mocks.feedback.choose.mockResolvedValue('import');
    mocks.pickEditorSpecFile.mockResolvedValue('C:/imports/XY.ship');
    mocks.loadSpecEditorImport.mockResolvedValue({ hullId: 'XY', hullName: 'Imported' });
    const viewModel = createViewModel();
    await viewModel.initializeEditorWindow();
    await vi.waitFor(() => expect(viewModel.editorData.value?.spec).toEqual({ hullId: 'XY', hullName: 'Imported' }));
    expect(viewModel.canSaveSpec.value).toBe(true);
    expect(viewModel.draftDirty.value).toBe(true);
    mocks.saveSpecEditorSpecByKind.mockResolvedValue(writeResultFixture({ hullId: 'XY', hullName: 'Imported' }));
    await viewModel.saveEditorData();
    expect(mocks.saveSpecEditorSpecByKind).toHaveBeenCalledWith(
      's1',
      'M:/mod',
      entityTargetFixture('ship', 'XY', 'create'),
      { hullId: 'XY', hullName: 'Imported' },
      { preserveOriginalJson: true, confirmedSources: [] },
      [{ path: 'M:/mod/data/hulls/XY.ship', fingerprint: 'destination' }],
      expect.any(Object),
      undefined,
    );
    expect(viewModel.draftDirty.value).toBe(false);
    expect(viewModel.editorData.value?.isNew).toBe(false);
    expect(mocks.closeCurrentWindow).not.toHaveBeenCalled();
    viewModel.disposeEditorWindow();
  });

  it('keeps the default spec when the user chooses to create', async () => {
    mocks.querySpecEditorData.mockResolvedValue(shipBundleFixture(true));
    mocks.feedback.choose.mockResolvedValue('create');
    const viewModel = createViewModel();
    await viewModel.initializeEditorWindow();
    await vi.waitFor(() => expect(viewModel.editorData.value?.isNew).toBe(true));
    expect(viewModel.canSaveSpec.value).toBe(true);
    expect(mocks.closeCurrentWindow).not.toHaveBeenCalled();
    viewModel.disposeEditorWindow();
  });
});

describe('useSpecEditorWindowViewModel external updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.feedback.choose.mockResolvedValue(null);
  });
  it.each(['ship', 'weapon', 'projectile', 'system'] as const)(
    'accepts a complete %s receipt once with zero detail queries for clean and dirty drafts',
    async (kind) => {
      const idField = kind === 'ship' ? 'hullId' : 'id';
      const original = { [idField]: 'XY', name: 'Original' };
      const vm = await initializedViewModel(kind, {
        kind,
        target: entityTargetFixture(kind, 'XY'),
        spec: original,
        isNew: false,
        baseVersions: [],
      });
      mocks.querySpecEditorData.mockClear();
      await savedSpecChange({ kind, sessionId: 's1', modRoot: 'M:/mod', id: 'XY', spec: { ...original, name: 'Formal' } });
      expect(mocks.querySpecEditorData).toHaveBeenCalledTimes(0);
      expect(vm.draftValue.value).toEqual({ ...original, name: 'Formal' });
      vm.updateEditorDraft({ ...original, name: 'Draft' });
      await savedSpecChange({ kind, sessionId: 's1', modRoot: 'M:/mod', id: 'XY', spec: { ...original, name: 'Next' } });
      expect(mocks.querySpecEditorData).toHaveBeenCalledTimes(0);
      expect(vm.draftValue.value).toEqual({ ...original, name: 'Draft' });
      expect(vm.externalUpdateNotice.value).toContain('外部版本已更新');
    },
  );

  it('stages a conflicting external save as a pending external version', async () => {
    const viewModel = await initializedViewModel();
    viewModel.updateEditorDraft({ hullId: 'XY', hullName: 'Local Edit' });

    await savedSpecChange({
      kind: 'ship',
      sessionId: 's1',
      modRoot: 'M:/mod',
      id: 'XY',
      spec: { hullId: 'XY', hullName: 'Other Window' },
      writeResult: writeResultFixture(),
    });

    expect(viewModel.draftDirty.value).toBe(true);
    expect(viewModel.draftValue.value).toEqual({ hullId: 'XY', hullName: 'Local Edit' });
    expect(viewModel.externalUpdateNotice.value).toContain('外部版本已更新');
  });

  it('adopts an external save directly when the draft is clean', async () => {
    const viewModel = await initializedViewModel();
    await savedSpecChange({
      kind: 'ship',
      sessionId: 's1',
      modRoot: 'M:/mod',
      id: 'XY',
      spec: { hullId: 'XY', hullName: 'External' },
      writeResult: writeResultFixture(),
    });
    expect(viewModel.draftValue.value).toEqual({ hullId: 'XY', hullName: 'External' });
    expect(viewModel.draftDirty.value).toBe(false);
    expect(viewModel.editorData.value?.spec).toEqual({ hullId: 'XY', hullName: 'External' });
  });

  it('ignores saved events for other mods or targets', async () => {
    const viewModel = await initializedViewModel();
    await savedSpecChange({ kind: 'ship', sessionId: 'other', modRoot: 'M:/mod', id: 'XY', spec: { hullId: 'XY' } });
    await savedSpecChange({ kind: 'ship', sessionId: 's1', modRoot: 'M:/mod', id: 'ZZ', spec: { hullId: 'ZZ' } });
    expect(viewModel.draftValue.value).toEqual({ hullId: 'XY', hullName: 'Test Ship' });
  });

  it('loads the staged external version on demand', async () => {
    const viewModel = await initializedViewModel();
    viewModel.updateEditorDraft({ hullId: 'XY', hullName: 'Local' });
    await savedSpecChange({
      kind: 'ship',
      sessionId: 's1',
      modRoot: 'M:/mod',
      id: 'XY',
      spec: { hullId: 'XY', hullName: 'Remote' },
      writeResult: writeResultFixture(),
    });

    viewModel.loadPendingExternalSpec();
    mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
    expect(viewModel.draftValue.value).toEqual({ hullId: 'XY', hullName: 'Remote' });
    expect(viewModel.draftDirty.value).toBe(false);
    expect(viewModel.externalUpdateNotice.value).toBe('');
  });
});

describe.each(['ship', 'weapon'] as const)('%s draft resource lifecycle', (kind) => {
  const field = kind === 'ship' ? 'spriteName' : 'turretSprite';
  const spec = (path: string): RowData => ({ hullId: 'XY', id: 'XY', [field]: path });
  const images = (path: string) => ({
    resourceRefs: [{ source: 'mod', ownerKind: kind, ownerId: 'XY', key: kind === 'ship' ? 'sprite' : field, relPath: path }],
    spriteData: kind === 'ship' ? path : { [field]: path },
  });
  const bundle = (path: string) =>
    kind === 'ship'
      ? { ...shipBundleFixture(), ...images(path), spec: spec(path) }
      : {
          kind,
          baseVersions: [],
          isNew: false,
          spec: spec(path),
          weaponCsvRow: {},
          projectileSpecs: {},
          ...images(path),
        };

  function invalidateDetail() {
    void projectChangeFixture('s1', {
      paths: [],
      tables: [],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'entity-detail', entity: { kind, id: 'XY' }, table: null, source: null, resource: null }],
    });
  }

  async function open() {
    mocks.querySpecEditorData.mockResolvedValue(bundle('old.png'));
    const vm = createViewModel(kind);
    await vm.initializeEditorWindow();
    await flushPromises();
    return vm;
  }

  function expectImage(vm: ReturnType<typeof createViewModel>, path: string) {
    expect(vm.draftValue.value[field]).toBe(path);

    expect(typeof vm.spriteData.value === 'string' ? vm.spriteData.value : vm.spriteData.value[field]).toBe(path);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.feedback.choose.mockResolvedValue(null);
  });

  it('keeps draft resources after a real detail cache invalidation', async () => {
    const vm = await open();
    vm.updateEditorDraft(spec('new.png'));
    await flushPromises();
    expectImage(vm, 'new.png');
    invalidateDetail();
    await flushPromises();
    expectImage(vm, 'new.png');
    expect(vm.draftDirty.value).toBe(true);
    expect(vm.externalUpdateNotice.value).toBe('');
    expect(mocks.queryDraftEditorImages).toHaveBeenLastCalledWith('s1', kind, 'XY', spec('new.png'), expect.any(AbortSignal));
  });

  it('uses edits made during a detail query and ignores its older image response', async () => {
    const vm = await open();
    vm.updateEditorDraft(spec('new.png'));
    await flushPromises();
    let releaseDetail!: (value: unknown) => void;
    mocks.querySpecEditorData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDetail = resolve;
        }),
    );
    invalidateDetail();
    await flushPromises();
    vm.updateEditorDraft(spec('later.png'));
    await flushPromises();
    expectImage(vm, 'later.png');
    releaseDetail(bundle('old.png'));
    await flushPromises();
    expect(vm.draftValue.value[field]).toBe('later.png');
    expectImage(vm, 'later.png');
    vm.updateEditorDraft(spec('latest.png'));
    await flushPromises();
    expectImage(vm, 'latest.png');
    expectImage(vm, 'latest.png');
  });

  it('clears a failed resource projection and retries on resource invalidation', async () => {
    const vm = await open();
    mocks.queryDraftEditorImages.mockRejectedValueOnce(new Error('image failed'));
    vm.updateEditorDraft(spec('new.png'));
    await flushPromises();
    expect(vm.spriteData.value).toEqual(kind === 'ship' ? {} : {});
    expect(typeof vm.spriteData.value === 'string' ? vm.spriteData.value : (vm.spriteData.value[field] ?? '')).toBe('');
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
    void projectChangeFixture('s1', {
      paths: [],
      tables: [],
      entities: [],
      queryScopes: [],
      resources: [{ source: 'mod', relPath: 'new.png' }],
      session: false,
    });
    await flushPromises();
    expectImage(vm, 'new.png');
  });

  it('loads resources for clean external saves and explicitly accepted pending data', async () => {
    const vm = await open();
    const external = (path: string) =>
      savedSpecChange({
        kind,
        sessionId: 's1',
        modRoot: 'M:/mod',
        id: 'XY',
        spec: spec(path),
        writeResult: { ...writeResultFixture() },
      });
    void external('external.png');
    await flushPromises();
    expectImage(vm, 'external.png');
    vm.updateEditorDraft(spec('local.png'));
    await flushPromises();
    void external('pending.png');
    await flushPromises();
    expectImage(vm, 'local.png');
    vm.loadPendingExternalSpec();
    mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
    await flushPromises();
    expectImage(vm, 'pending.png');
    expect(vm.draftDirty.value).toBe(false);
  });

  it('resolves imported image fields through the draft query', async () => {
    mocks.querySpecEditorData.mockResolvedValue({ ...bundle('old.png'), isNew: true });
    mocks.feedback.choose.mockResolvedValue('import');
    mocks.pickEditorSpecFile.mockResolvedValue('M:/imported.spec');
    mocks.loadSpecEditorImport.mockResolvedValue(spec('imported.png'));
    const vm = createViewModel(kind);
    await vm.initializeEditorWindow();
    await flushPromises();
    expectImage(vm, 'imported.png');
    expect(vm.draftDirty.value).toBe(true);
  });

  it('keeps the actual canvas component on the draft image after refresh', async () => {
    setActivePinia(createPinia());
    installCanvas2DStub();
    const sources: string[] = [];
    vi.stubGlobal(
      'Image',
      class {
        width = 64;
        height = 32;
        naturalWidth = 64;
        naturalHeight = 32;
        complete = true;
        onload: (() => void) | null = null;
        current = '';
        get src() {
          return this.current;
        }
        set src(path: string) {
          this.current = path;
          sources.push(path);
          if (path) queueMicrotask(() => this.onload?.());
        }
      },
    );
    const vm = await open();
    const wrapper = mount(
      {
        setup() {
          return () => {
            const common = {
              modRoot: 'M:/mod',
              sessionId: 's1',
              editContext: vm.editContext.value,
              dirty: vm.draftDirty.value,
              canSave: vm.canSaveSpec.value,
              saving: vm.draftSaving.value,
              externalUpdateNotice: vm.externalUpdateNotice.value,
              onDraftChanged: (draft: RowData) => vm.updateEditorDraft(draft),
            };
            return kind === 'ship'
              ? h(SpecShipEditor, {
                  ...common,
                  hullId: 'XY',
                  ship: vm.editorData.value!.spec,
                  spriteData: typeof vm.spriteData.value === 'string' ? vm.spriteData.value : '',
                  spriteSourcePath: vm.imageRefs.value[0]?.relPath,
                })
              : h(SpecWeaponEditor, {
                  ...common,
                  weaponId: 'XY',
                  weapon: vm.editorData.value!.spec,
                  spriteData: typeof vm.spriteData.value === 'string' ? {} : vm.spriteData.value,
                });
          };
        },
      },
      { global: { stubs: editorUiStubs }, attachTo: document.body },
    );
    try {
      const pathInput = wrapper.get(`[data-field-path="${field}"]`).getComponent({ name: 'SchemaReferenceInput' });
      pathInput.vm.$emit('update', { kind: 'set', value: 'new.png' });
      await flushPromises();
      expect(sources).toContain('new.png');
      sources.length = 0;
      invalidateDetail();
      await flushPromises();
      expect(sources.filter(Boolean)).toEqual([]);
      expect(wrapper.find('canvas.editor-canvas').exists()).toBe(true);
      if (kind === 'ship') {
        const sync = wrapper.findAll('button').find((button) => button.text() === '按图片更新宽高');
        expect(sync).toBeDefined();
        await sync!.trigger('click');
        await flushPromises();
        expect(vm.draftValue.value).toMatchObject({ spriteName: 'new.png', width: 64, height: 32 });
      }
    } finally {
      wrapper.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ignores detail and image completions after disposal', async () => {
    const vm = await open();
    let releaseImage!: (value: unknown) => void;
    let releaseDetail!: (value: unknown) => void;
    mocks.queryDraftEditorImages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseImage = resolve;
        }),
    );
    vm.updateEditorDraft(spec('new.png'));
    await flushPromises();
    mocks.querySpecEditorData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDetail = resolve;
        }),
    );
    invalidateDetail();
    await flushPromises();
    vm.disposeEditorWindow();
    const before = vm.editorData.value;
    releaseImage(images('new.png'));
    releaseDetail(bundle('old.png'));
    await flushPromises();
    expect(vm.editorData.value).toBe(before);
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });
});
