import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import JsonEditorWorkspace from './JsonEditorWorkspace.vue';
import JsonDocumentEditor from './JsonDocumentEditor.vue';
import JsonDocumentList from './JsonDocumentList.vue';
import type { EntityIdentityAppliedEvent } from '@/windows/window.events';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { jsonEntityFixture } from '@/test/fixtures/json-editor';
import { sessionUpdateFixture, savedWriteFixture } from '@/test/fixtures/write-result';
import { editorUiStubs } from '@/test/unit/ui-stubs';
import { getSchema } from '@/domain/schema/config-schema-registry';
import { JSON_DOCUMENT_DEFINITIONS } from '@/domain/json-editor/json-document-definitions';
import * as miscConfig from '@/domain/json-editor/misc-config-files';
import type { AppFeedback, EntityData, JsonEditorPageId, RowData, JsonRecoveryRequest, IndexedConfigEntityPayload } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  listeners: new Set<(event: EntityIdentityAppliedEvent) => Promise<void>>(),
  list: vi.fn(),
  read: vi.fn(),
  saveFile: vi.fn(),
  saveIndexed: vi.fn(),
  saveMod: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  complete: vi.fn(),
  prepare: vi.fn(),
  slots: vi.fn(),
  previews: vi.fn(),
  miscRead: vi.fn(),
  miscList: vi.fn(),
  miscSave: vi.fn(),
  miscDelete: vi.fn(),
  openImmersive: vi.fn(),
  hullTarget: vi.fn(),
  feedback: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    choose: vi.fn(),
    confirmWarning: vi.fn<AppFeedback['confirmWarning']>(),
    confirmDanger: vi.fn<AppFeedback['confirmDanger']>(),
  },
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => mocks.feedback }));
vi.mock('@/orchestrators/immersive-editor.orchestrator', () => ({ openVariantImmersiveEditor: mocks.openImmersive }));
vi.mock('@/app/composables/use-core-schema', () => ({
  useCoreSchema: () => ({
    loadCoreFields: async () => {},
    getMergedSchema: (kind: string) =>
      kind === 'strings'
        ? getSchema(kind)
        : {
            ...getSchema(kind),
            sections: [
              {
                id: 'main',
                label: 'Fields',
                fields: [
                  {
                    key:
                      kind === 'mod-info'
                        ? 'file.name'
                        : kind === 'faction'
                          ? 'file.displayName'
                          : kind === 'mission'
                            ? 'descriptor.title'
                            : kind === 'skin'
                              ? 'hullName'
                              : 'displayName',
                    label: 'Name',
                    type: 'string',
                  },
                  {
                    key:
                      kind === 'mission'
                        ? 'list.mission'
                        : kind === 'mod-info' || kind === 'faction'
                          ? 'file.id'
                          : kind === 'skin'
                            ? 'skinHullId'
                            : 'variantId',
                    label: 'ID',
                    type: 'string',
                  },
                  { key: 'settings', label: 'Settings', type: 'object' },
                ],
              },
            ],
          },
  }),
}));
vi.mock('@/services/entity-query.service', async (original) => ({
  ...(await original<typeof import('@/services/entity-query.service')>()),
  querySessionEntityList: mocks.list,
  querySessionEntity: mocks.read,
  querySessionEntityEditTarget: mocks.hullTarget,
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async (original) => ({
  ...(await original<typeof import('@/orchestrators/project-sync.orchestrator')>()),
  listenEntityIdentityApplied: async (listener: (event: EntityIdentityAppliedEvent) => Promise<void>) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
}));
vi.mock('@/orchestrators/json-save.orchestrator', () => ({
  completeJsonSave: mocks.complete,
  saveVariantAction: mocks.saveFile,
  saveSkinAction: mocks.saveFile,
  saveIndexedEntityAction: mocks.saveIndexed,
  saveModInfoAction: mocks.saveMod,
  createVariantAction: mocks.create,
  createSkinAction: mocks.create,
  createIndexedEntityAction: mocks.create,
  deleteVariantAction: mocks.remove,
  deleteSkinAction: mocks.remove,
  deleteIndexedEntityAction: mocks.remove,
}));
vi.mock('@/services/json-recovery.service', () => ({ prepareJsonSourceRecovery: mocks.prepare }));
vi.mock('@/services/misc-config.service', async (original) => ({
  ...(await original<typeof import('@/services/misc-config.service')>()),
  queryMiscConfigFiles: mocks.miscList,
  queryMiscConfigFile: mocks.miscRead,
  saveMiscConfig: mocks.miscSave,
  deleteMiscConfig: mocks.miscDelete,
}));
vi.mock('@/services/json-entity.service', () => ({ queryFactionPreviewImages: mocks.previews, queryMissionDraftIcon: async () => '' }));
vi.mock('@/services/hull-reference.service', () => ({
  querySessionHullReferences: async () => ({ hullNames: {} }),
  queryHullReferenceOptions: async () => [],
  queryBuiltInWeaponSlotOptions: mocks.slots,
}));
vi.mock('@/app/composables/use-visible-resource-media', () => ({
  useVisibleResourceMedia: () => ({
    mediaRef: () => () => {},
    mediaVisible: () => true,
    mediaSrc: () => '',
    recordListFirstFrame: async () => {},
    setMediaRoot: () => {},
  }),
}));
let wrapper: VueWrapper | null;
let entities: Map<string, EntityData>;
let serial: number;
const pages = (Object.keys(JSON_DOCUMENT_DEFINITIONS) as JsonEditorPageId[]).filter((page) => page !== 'misc-config');
const key = (session: string, kind: string, id: string) => [session, kind, id].join(':');
function manifest(session = 's1', root = 'M:/one') {
  const result = sessionUpdateFixture(session, root).projection.manifest;
  result.modInfo = { id: 'mod', name: 'Saved' };
  result.baseVersions = [{ path: root + '/mod_info.json', fingerprint: 'v1' }];
  return result;
}
function register() {
  for (const [session, root] of [
    ['s1', 'M:/one'],
    ['s2', 'M:/two'],
  ]) {
    useWorkspaceStore().registerMod({ modRoot: root!, displayName: root!, version: '', status: 'ready' });
    useProjectStore().registerProjectManifest(manifest(session, root));
    for (const kind of ['faction', 'mission', 'variant', 'skin'] as const)
      for (const id of ['a', 'b']) entities.set(key(session!, kind, id), jsonEntityFixture(kind, id, 'Saved', root));
  }
}
async function mountPage(page: JsonEditorPageId, root = 'M:/one') {
  useWorkspaceStore().activateModJson(root, page);
  wrapper = mount(JsonEditorWorkspace, { attachTo: document.body, global: { stubs: { ...editorUiStubs, 'n-modal': true } } });
  useSaveCommandStore().registerActiveSaveHandler(async () => {
    try {
      await useJsonEditorStore().active!.save();
    } catch (error) {
      mocks.feedback.error(error);
    }
  });
  await flushPromises();
}
const nameInput = () => wrapper!.get<HTMLInputElement>('.schema-section input');
function savedFile(session: string, root: string, id: string, data: RowData, previous: string | null, relPath: string) {
  const kind = relPath.endsWith('.skin') ? 'skin' : 'variant',
    before = entities.get(key(session, kind, previous ?? id))!;
  const after = jsonEntityFixture(kind, id, 'Written', root);
  after.data = data;
  const receipt = savedWriteFixture();
  receipt.commitId = ++serial;
  receipt.baseVersions = after.baseVersions.map((version) => ({ ...version, fingerprint: 'v2' }));
  receipt.identityChanges = [{ before: before.target, after: after.target }];
  entities.delete(key(session, kind, before.id));
  entities.set(key(session, kind, id), { ...after, baseVersions: receipt.baseVersions });
  return { entity: { id, relPath: after.target.write.relPath, data, baseVersions: receipt.baseVersions }, receipt };
}
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ editMode: 'smart' }));
  vi.clearAllMocks();
  mocks.listeners.clear();
  entities = new Map();
  serial = 1;
  wrapper = null;
  register();
  mocks.list.mockImplementation(async (session: string, kind: string) =>
    [...entities.entries()]
      .filter(([id]) => id.startsWith(session + ':' + kind + ':'))
      .map(([, entity]) => (entity.kind === 'mission' ? { ...entity, data: { list: (entity.data as RowData).list } } : entity)),
  );
  mocks.read.mockImplementation(async (session: string, kind: string, id: string) => entities.get(key(session, kind, id)) ?? null);
  mocks.saveFile.mockImplementation(async (...args: Parameters<typeof savedFile>) => savedFile(...args));
  mocks.saveIndexed.mockImplementation(async (write: IndexedConfigEntityPayload) => {
    const before = entities.get(key(write.sessionId, write.kind, write.previousId!))!,
      after = jsonEntityFixture(write.kind, write.nextId, 'Written', write.modRoot);
    after.data = write.kind === 'faction' ? write.entityData.file! : { ...write.entityData, list: write.indexRow };
    const receipt = savedWriteFixture();
    receipt.commitId = ++serial;
    receipt.baseVersions = after.baseVersions;
    receipt.identityChanges = [{ before: before.target, after: after.target }];
    entities.delete(key(write.sessionId, write.kind, before.id));
    entities.set(key(write.sessionId, write.kind, after.id), after);
    return { entity: { entityData: write.entityData, indexRows: [{ data: write.indexRow, isComment: false }] }, receipt };
  });
  mocks.complete.mockImplementation(async (modRoot: string, _session: string, result: import('@/shared/types').WriteResult) => {
    useProjectSyncStore().markAccepted({ modRoot, result } as import('@/shared/types').CommittedWriteEvent);
  });
  mocks.prepare.mockImplementation(async (request: JsonRecoveryRequest) => {
    if (request.origin.kind === 'entity') {
      const entity = entities.get(key(request.sessionId, request.origin.target.kind, request.origin.target.id))!;
      const data = entity.data as RowData;
      return {
        request,
        missingPaths: [],
        baseVersions: entity.baseVersions,
        currentSources:
          entity.kind === 'mission'
            ? { descriptor: data.descriptor, text: data.text, index: { rows: [{ isComment: false, data: data.list }] } }
            : { file: data },
        resourceRefs: entity.resourceRefs,
      };
    }
    const source = useProjectStore().getManifest(request.modRoot)!;
    return { request, missingPaths: [], baseVersions: source.baseVersions, currentSources: { file: source.modInfo }, resourceRefs: {} };
  });
  mocks.feedback.choose.mockResolvedValue('follow');
  mocks.feedback.confirmWarning.mockImplementation((options) => options.onConfirm());
  mocks.previews.mockResolvedValue({ logoSrc: '', crestSrc: '' });
  mocks.slots.mockResolvedValue([]);
  mocks.miscList.mockResolvedValue([
    { kind: 'strings', path: 'M:/one/data/strings/strings.json', relPath: 'data/strings/strings.json', state: 'missing', error: null },
  ]);
  mocks.miscRead.mockResolvedValue(null);
});
import { useProjectSyncStore } from '@/stores/project-sync.store';
afterEach(() => {
  wrapper?.unmount();
  useJsonEditorStore().releaseSession('s1');
  useJsonEditorStore().releaseSession('s2');
  vi.restoreAllMocks();
});
describe('JSON common workspace and form', () => {
  it.each(['skins', 'variants'] as const)('%s shows the common immersive action and opens its saved identity', async (page) => {
    await mountPage(page);
    const actions = wrapper!.findAll('.editor-actions button');
    expect(actions[0]?.text()).toBe('沉浸式编辑器');
    await actions[0]!.trigger('click');
    await flushPromises();
    expect(mocks.openImmersive).toHaveBeenCalledExactlyOnceWith(
      { sessionId: 's1', modRoot: 'M:/one', kind: page === 'skins' ? 'skin' : 'variant', id: 'a' },
      mocks.feedback,
    );
  });
  it.each(['factions', 'mission'] as const)('%s keeps the immersive action hidden', async (page) => {
    await mountPage(page);
    expect(wrapper!.findAll('.editor-actions button').map((button) => button.text())).not.toContain('沉浸式编辑器');
    expect(mocks.openImmersive).not.toHaveBeenCalled();
  });
  it('reports a skin immersive open failure once', async () => {
    const error = new Error('open failed');
    mocks.openImmersive.mockRejectedValueOnce(error);
    await mountPage('skins');
    await wrapper!.find('.editor-actions button').trigger('click');
    await flushPromises();
    expect(mocks.feedback.error).toHaveBeenCalledExactlyOnceWith(error, '打开舰船皮肤沉浸式编辑器失败');
  });
  it('skin jumps to a Mod hull row and keeps the target identity request', async () => {
    const manifest = useProjectStore().getManifest('M:/one')!;
    useCsvEditorStore().initializeModTables({ sessionId: 's1', modRoot: 'M:/one', manifest });
    mocks.hullTarget.mockResolvedValueOnce({
      target: {
        kind: 'ship',
        id: 'hull',
        source: { source: 'mod', root: 'M:/one', relPath: 'data/hulls/ship_data.csv', path: 'M:/one/data/hulls/ship_data.csv' },
        write: { source: 'mod', root: 'M:/one', relPath: 'data/hulls/ship_data.csv', path: 'M:/one/data/hulls/ship_data.csv' },
        state: 'existing',
        linkedRecord: { kind: 'csv', table: 'ships', rowKey: 'ship-row' },
      },
      baseVersions: [],
    });
    await mountPage('skins');
    await wrapper!
      .findAll('.editor-actions button')
      .find((button) => button.text() === '跳转到船体')!
      .trigger('click');
    await flushPromises();
    expect(mocks.hullTarget).toHaveBeenCalledWith('s1', 'ship', 'hull', expect.any(AbortSignal));
    expect(useWorkspaceStore().currentView).toBe('table');
    expect(useCsvEditorStore().currentTab).toBe('ships');
    expect(useWorkspaceStore().entityLocation).toMatchObject({
      sessionId: 's1',
      modRoot: 'M:/one',
      kind: 'ship',
      id: 'hull',
      rowKey: 'ship-row',
    });
  });
  it('keeps the skin page and explains a Core base hull', async () => {
    mocks.hullTarget.mockResolvedValueOnce({
      target: {
        kind: 'ship',
        id: 'hull',
        source: { source: 'core', root: 'M:/game', relPath: 'data/hulls/ship_data.csv', path: 'M:/game/data/hulls/ship_data.csv' },
        write: { source: 'mod', root: 'M:/one', relPath: 'data/hulls/ship_data.csv', path: 'M:/one/data/hulls/ship_data.csv' },
        state: 'existing',
        linkedRecord: null,
      },
      baseVersions: [],
    });
    await mountPage('skins');
    await wrapper!
      .findAll('.editor-actions button')
      .find((button) => button.text() === '跳转到船体')!
      .trigger('click');
    await flushPromises();
    expect(useWorkspaceStore().currentView).toBe('json-editor');
    expect(useWorkspaceStore().entityLocation).toBeNull();
    expect(mocks.feedback.info).toHaveBeenCalledExactlyOnceWith('船体「hull」来自原版。');
  });
  it.each(['variants', 'skins'] as const)('%s locates and scrolls to an exact entity while retaining another draft', async (page) => {
    const kind = page === 'skins' ? 'skin' : 'variant';
    for (let index = 0; index < 80; index++) {
      const id = 'entity_' + String(index).padStart(3, '0');
      entities.set(key('s1', kind, id), jsonEntityFixture(kind, id, 'Listed'));
    }
    entities.set(key('s1', kind, 'target_id'), jsonEntityFixture(kind, 'target_id', 'Located'));
    await mountPage(page);
    await nameInput().setValue('Local');
    const draft = useJsonEditorStore().active!;
    const row = wrapper!.get('[data-entity-id="target_id"]').element;
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ top: 900 - row.parentElement!.scrollTop }) as DOMRect);
    useWorkspaceStore().entityLocation = { sessionId: 's1', modRoot: 'M:/one', kind, id: 'target_id' };
    await flushPromises();
    expect(wrapper!.get('.json-entity-list-item.active').attributes('data-entity-id')).toBe('target_id');
    expect(wrapper!.get('.json-entity-list-items').element.scrollTop).toBe(900);
    expect(useWorkspaceStore().entityLocation).toBeNull();
    expect(nameInput().element.value).toBe('Located');
    expect(draft.dirty.value).toBe(true);
    await wrapper!.get('[data-entity-id="a"]').trigger('click');
    await flushPromises();
    expect(useJsonEditorStore().active).toBe(draft);
    expect(nameInput().element.value).toBe('Local');
  });
  it.each(['variants', 'skins', 'factions', 'mission'] as const)(
    '%s marks pending and retained drafts and clears the mark after saving',
    async (page) => {
      await mountPage(page);
      nameInput().element.value = 'Pending';
      await nameInput().trigger('input');
      expect(wrapper!.get('.json-entity-list-item.active').classes()).toContain('dirty');
      await nameInput().trigger('keydown', { key: 'Escape' });
      expect(wrapper!.find('.json-entity-list-item.dirty').exists()).toBe(false);
      await nameInput().setValue('Local');
      await wrapper!.findAll('.json-entity-list-item')[1]!.trigger('click');
      await flushPromises();
      expect(wrapper!.get('.json-entity-list-item.dirty').text()).toContain('Local');
      expect(wrapper!.get('.json-entity-list-item.active').text()).toContain('b');
      await wrapper!.get('.json-entity-list-item.dirty').trigger('click');
      await flushPromises();
      await useJsonEditorStore().active!.save();
      await flushPromises();
      expect(wrapper!.find('.json-entity-list-item.dirty').exists()).toBe(false);
    },
  );
  it.each(['smart', 'plain'] as const)('consumes a file definition schema and initial content in %s mode', async (editMode) => {
    initializeSettingsStore(createSettingsFixture({ editMode }));
    const definition = {
      ...miscConfig.miscConfigFile('strings'),
      schema: 'faction',
      initial: { id: 'fixture', displayName: 'Defined', unknown: '001' },
    };
    vi.spyOn(miscConfig, 'miscConfigFile').mockReturnValue(definition);
    let saved = false;
    const path = 'M:/one/data/strings/strings.json';
    mocks.miscList.mockImplementation(async () => [{ kind: 'strings', state: saved ? 'present' : 'missing', error: null }]);
    mocks.miscRead.mockImplementation(async () => ({
      kind: 'strings',
      data: definition.initial,
      baseVersions: [{ path, fingerprint: 'created' }],
    }));
    mocks.prepare.mockImplementation(async (request) => ({
      request,
      baseVersions: [{ path, fingerprint: null }],
      missingPaths: saved ? [] : [definition.path],
      currentSources: {},
      resourceRefs: {},
    }));
    mocks.miscSave.mockImplementation(async () => {
      saved = true;
      return { ...savedWriteFixture(), commitId: ++serial };
    });
    await mountPage('misc-config');
    await wrapper!.get('.empty-state button').trigger('click');
    await flushPromises();
    expect(mocks.miscSave.mock.lastCall![0]).toMatchObject({ data: definition.initial, orderedJson: JSON.stringify(definition.initial) });
    const doc = wrapper!.getComponent(JsonDocumentEditor).props('document');
    expect(doc.schema.value.id).toBe('faction');
    expect(doc.draftValue.value).toEqual({ file: definition.initial });
    await wrapper!.get('[data-field-path="file.displayName"] input, [data-field-path="file.displayName"] textarea').setValue('Edited');
    await doc.inputs.commit();
    expect(doc.draftValue.value.file).toMatchObject({ displayName: 'Edited', unknown: '001' });
    const projected = miscConfig.miscConfigValue('strings', ['001', { value: '123' }]);
    expect(miscConfig.miscConfigContent('strings', projected)).toEqual(['001', { value: '123' }]);
  });
  it('preserves parse diagnostics and separates failure from a missing registered file', async () => {
    const error = {
      code: 'parse.json_syntax',
      message: 'invalid syntax',
      location: { path: 'M:/one/data/strings/strings.json', line: 3, column: 2 },
    };
    mocks.miscRead.mockRejectedValueOnce(error);
    mocks.miscList.mockResolvedValue([{ kind: 'strings', state: 'present', error: null }]);
    await mountPage('misc-config');
    expect(wrapper!.get('.empty-state').text()).toContain('第 3 行，第 2 列');
    expect(wrapper!.find('.json-entity-list-footer').exists()).toBe(false);
    await wrapper!
      .findAll('.empty-state button')
      .find((button) => button.text() === '修复文件')!
      .trigger('click');
    expect(mocks.feedback.error.mock.lastCall![0]).toBe(error);
    expect(mocks.miscSave).not.toHaveBeenCalled();
    mocks.miscRead.mockResolvedValue({ kind: 'strings', data: {}, baseVersions: [{ path: error.location.path, fingerprint: 'fixed' }] });
    await wrapper!
      .findAll('.empty-state button')
      .find((button) => button.text() === '重试')!
      .trigger('click');
    await flushPromises();
    expect(wrapper!.findComponent(JsonDocumentEditor).exists()).toBe(true);
  });
  it('creates and selects a registered file, retains its draft across navigation, and confirms deletion', async () => {
    let exists = false;
    const path = 'M:/one/data/strings/strings.json';
    mocks.miscList.mockImplementation(async () => [
      { kind: 'strings', path, relPath: 'data/strings/strings.json', state: exists ? 'present' : 'missing', error: null },
    ]);
    mocks.miscRead.mockImplementation(async () =>
      exists ? { kind: 'strings', data: {}, baseVersions: [{ path, fingerprint: 'v1' }] } : null,
    );
    mocks.prepare.mockImplementation(async (request) => ({
      request,
      baseVersions: [{ path, fingerprint: exists ? 'v1' : null }],
      missingPaths: exists ? [] : ['data/strings/strings.json'],
      currentSources: {},
      resourceRefs: {},
    }));
    mocks.miscSave.mockImplementation(async () => {
      exists = true;
      return { ...savedWriteFixture(), commitId: ++serial, baseVersions: [{ path, fingerprint: 'v1' }] };
    });
    mocks.miscDelete.mockImplementation(async () => {
      exists = false;
      return { ...savedWriteFixture(), commitId: ++serial };
    });
    await mountPage('misc-config');
    expect(wrapper!.get('.json-entity-list-item.active').text()).toContain('未创建');
    expect(useJsonEditorStore().active).toBeNull();
    expect(mocks.miscRead).not.toHaveBeenCalled();
    await wrapper!.get('.empty-state button').trigger('click');
    await flushPromises();
    expect(wrapper!.findComponent(JsonDocumentEditor).exists()).toBe(true);
    const doc = useJsonEditorStore().active!;
    expect(doc.target.value!.id).toBe('strings');
    await wrapper!.get('.schema-form button').trigger('click');
    expect(doc.dirty.value).toBe(true);
    expect(wrapper!.get('.json-entity-list-item.active').classes()).toContain('dirty');
    const navigation = useWorkspaceNavigationActions();
    navigation.showSettings();
    await flushPromises();
    navigation.navigateToModJson('M:/one', 'misc-config');
    await flushPromises();
    expect(useJsonEditorStore().active).toBe(doc);
    expect(doc.dirty.value).toBe(true);
    expect(wrapper!.get('.json-entity-list-item.active').classes()).toContain('dirty');
    const editor = wrapper!.getComponent(JsonDocumentEditor);
    await editor
      .findAll('button')
      .find((button) => button.text() === '删除')!
      .trigger('click');
    expect(mocks.feedback.confirmDanger).toHaveBeenCalledOnce();
    await mocks.feedback.confirmDanger.mock.lastCall![0].onConfirm();
    await flushPromises();
    expect(mocks.miscDelete).toHaveBeenCalledOnce();
    expect(wrapper!.findComponent(JsonDocumentEditor).exists()).toBe(false);
    expect(wrapper!.get('.json-entity-list-item.active').text()).toContain('未创建');
    expect(wrapper!.get('.empty-state button').text()).toBe('创建文件');
    expect(useJsonEditorStore().documentStates('s1')).toHaveLength(0);
  });
  it.each(['success', 'failure'] as const)('rejects late file %s after switching Mod and returning to the same file', async (outcome) => {
    let resolve!: (value: object) => void, reject!: (error: Error) => void;
    mocks.miscList.mockResolvedValue([{ kind: 'strings', state: 'present', error: null }]);
    mocks.miscRead.mockImplementationOnce(
      () =>
        new Promise((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    );
    await mountPage('misc-config');
    expect(wrapper!.text()).toContain('正在读取');
    const path = 'M:/two/data/strings/strings.json';
    mocks.miscRead.mockResolvedValue({
      kind: 'strings',
      data: { group: { line: 'current' } },
      baseVersions: [{ path, fingerprint: 'v1' }],
    });
    useWorkspaceNavigationActions().navigateToModJson('M:/two', 'misc-config');
    await flushPromises();
    const current = useJsonEditorStore().active!;
    if (outcome === 'success') resolve({ kind: 'strings', data: { group: { line: 'late' } }, baseVersions: [] });
    else reject(new Error('late failure'));
    await flushPromises();
    expect(useJsonEditorStore().active).toBe(current);
    expect(current.target.value!.sessionId).toBe('s2');
    expect(useJsonEditorStore().documentStates('s1')).toHaveLength(0);
    expect(mocks.feedback.error).not.toHaveBeenCalled();
    useWorkspaceNavigationActions().navigateToModJson('M:/one', 'misc-config');
    await flushPromises();
    expect(useJsonEditorStore().active!.target.value!.sessionId).toBe('s1');
    expect(useJsonEditorStore().active!.target.value!.id).toBe('strings');
  });
  it.each(pages)('%s restores its selection, draft and history after rebuilding its page and switching Mods', async (page) => {
    await mountPage(page);
    const before = JSON.stringify(wrapper!.getComponent(SchemaFormRenderer).props('modelValue'));
    nameInput().element.value = 'L';
    await nameInput().trigger('input');
    nameInput().element.value = 'Loc';
    await nameInput().trigger('input');
    expect(JSON.stringify(wrapper!.getComponent(SchemaFormRenderer).props('modelValue'))).toBe(before);
    expect(useJsonEditorStore().active!.inputs.dirty.value).toBe(true);
    await nameInput().setValue('Local');
    const field = nameInput().element;
    const navigation = useWorkspaceNavigationActions();
    navigation.showSettings();
    await flushPromises();
    expect(useJsonEditorStore().active).toBeNull();
    expect(wrapper!.find('.schema-form').exists()).toBe(false);
    navigation.navigateToModJson('M:/one', page);
    await flushPromises();
    expect(nameInput().element).not.toBe(field);
    expect((nameInput().element as HTMLInputElement).value).toBe('Local');
    expect(await useJsonEditorStore().active!.undo()).toBe(true);
    await flushPromises();
    expect((nameInput().element as HTMLInputElement).value).toBe('Saved');
    expect(await useJsonEditorStore().active!.redo()).toBe(true);
    navigation.navigateToModJson('M:/two', page);
    await flushPromises();
    expect((nameInput().element as HTMLInputElement).value).toBe('Saved');
    await nameInput().setValue('Other');
    navigation.navigateToModJson('M:/one', page);
    await flushPromises();
    expect((nameInput().element as HTMLInputElement).value).toBe('Local');
  });
  it.each(pages.filter((page) => page !== 'mod-info'))(
    '%s saves A through its participant after leaving the page and rebuilding it on B',
    async (page) => {
      await mountPage(page);
      await nameInput().setValue('A draft');
      const docA = wrapper!.getComponent(JsonDocumentEditor).props('document');
      const baseline = docA.record.value!;
      wrapper!.unmount();
      wrapper = null;
      useJsonEditorStore().selection('s1', JSON_DOCUMENT_DEFINITIONS[page].kind).value = 'b';
      await mountPage(page);
      await nameInput().setValue('B draft');
      const handles = useSaveCommandStore().participantsForTargets([
        { sessionId: 's1', modRoot: 'M:/one', path: baseline.target.entity!.write.path },
      ]);
      expect(handles).toHaveLength(1);
      const result = await useSaveCommandStore().savePreparedParticipant(handles[0]!);
      expect(result.status).toBe('saved');
      expect(docA.dirty.value).toBe(false);
      expect((nameInput().element as HTMLInputElement).value).toBe('B draft');
      if (page === 'variants' || page === 'skins')
        expect(mocks.saveFile.mock.lastCall!).toMatchObject({ 0: 's1', 1: 'M:/one', 2: 'a', 7: baseline.baseVersions });
      else
        expect(mocks.saveIndexed.mock.lastCall![0]).toMatchObject({
          sessionId: 's1',
          modRoot: 'M:/one',
          previousId: 'a',
          baseVersions: baseline.baseVersions,
        });
    },
  );
  it.each(['variants', 'skins', 'factions', 'mission'] as const)(
    '%s keeps mounted input and list summary through its saved rename',
    async (page) => {
      await mountPage(page);
      await nameInput().setValue('Submitted');
      await wrapper!.findAll('.schema-section input')[1]!.setValue('next');
      const writer = page === 'variants' || page === 'skins' ? mocks.saveFile : mocks.saveIndexed;
      const original = writer.getMockImplementation()!;
      let finish!: () => void;
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      writer.mockImplementationOnce(async (...args: unknown[]) => {
        await gate;
        return original(...args);
      });
      const pending = useJsonEditorStore().active!.save();
      await flushPromises();
      const field = nameInput().element;
      await nameInput().setValue('Later');
      finish();
      await pending;
      await flushPromises();
      expect(nameInput().element).toBe(field);
      expect((nameInput().element as HTMLInputElement).value).toBe('Later');
      expect(wrapper!.get('.json-entity-list-item.active').text()).toContain('next');
      await useJsonEditorStore().active!.save();
      const doc = wrapper!.getComponent(JsonDocumentEditor).props('document');
      expect(doc.target.value!.id).toBe('next');
      expect(doc.dirty.value).toBe(false);
    },
  );
  it('keeps an invalid field, focus and navigation target while input submission fails', async () => {
    initializeSettingsStore(createSettingsFixture({ editMode: 'plain' }));
    await mountPage('variants');
    const field = wrapper!.get('[data-field-path="settings"] textarea');
    await field.setValue('{invalid');
    useWorkspaceNavigationActions().showSettings();
    await flushPromises();
    expect(useWorkspaceStore().currentView).toBe('json-editor');
    expect((field.element as HTMLTextAreaElement).value).toBe('{invalid');
    expect(document.activeElement).toBe(field.element);
  });
  it('executes the latest navigation intent after the registered save completes', async () => {
    await mountPage('variants');
    await nameInput().setValue('Submitted');
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const original = mocks.saveFile.getMockImplementation()!;
    mocks.saveFile.mockImplementationOnce(async (...args: Parameters<typeof savedFile>) => {
      await gate;
      return original(...args);
    });
    const pending = useJsonEditorStore().active!.save();
    const navigation = useWorkspaceNavigationActions();
    navigation.showSettings();
    navigation.showAbout();
    expect(useWorkspaceStore().currentView).toBe('json-editor');
    finish();
    await pending;
    await flushPromises();
    expect(useWorkspaceStore().currentView).toBe('about');
  });
  it('queries Skin removal slots from the current draft base hull', async () => {
    await mountPage('skins');
    const document = wrapper!.getComponent(JsonDocumentEditor).props('document');
    document.draftValue.value = { ...document.draftValue.value, baseHullId: 'other_hull' };
    await flushPromises();
    const runtime = wrapper!.getComponent(SchemaFormRenderer).props('runtimeContext')!;
    await runtime.querySourceOptions!('hull:builtInWeaponSlots');
    expect(mocks.slots).toHaveBeenLastCalledWith('s1', 'other_hull', undefined, 'builtInWeaponSlots');
  });
  it.each([
    ['hull:weaponSlots', 'weaponSlots'],
    ['hull:moduleSlots', 'moduleSlots'],
  ])('queries %s from the current variant hull', async (source, kind) => {
    await mountPage('variants');
    const document = wrapper!.getComponent(JsonDocumentEditor).props('document');
    document.draftValue.value = { ...document.draftValue.value, hullId: 'selected_hull' };
    await flushPromises();
    const runtime = wrapper!.getComponent(SchemaFormRenderer).props('runtimeContext')!;
    expect(runtime.sourceContextKey).toBe('selected_hull');
    await runtime.querySourceOptions!(source);
    expect(mocks.slots).toHaveBeenLastCalledWith('s1', 'selected_hull', undefined, kind);
  });
  it.each(['factions', 'mission'] as const)('%s combines source-removal policy with the draft deletion confirmation', async (page) => {
    await mountPage(page);
    await nameInput().setValue('Local');
    const host = wrapper!.getComponent(JsonDocumentEditor);
    const remove = vi.fn(async () => true);
    const editor = mount(JsonDocumentEditor, { props: { ...host.props(), remove }, global: { stubs: editorUiStubs } });
    for (const removeSource of [false, true]) {
      await editor
        .findAll('button')
        .find((button) => button.text() === '删除')!
        .trigger('click');
      const confirmation = mocks.feedback.confirmDanger.mock.lastCall![0];
      const content = mount({ render: confirmation.content as () => import('vue').VNode }, { global: { stubs: editorUiStubs } });
      const checkbox = content.get('input[type="checkbox"]');
      await checkbox.setValue(removeSource);
      await confirmation.onConfirm();
      expect(remove).toHaveBeenLastCalledWith(host.props('document').record.value, removeSource);
      content.unmount();
    }
    editor.unmount();
  });
  it.each(pages.filter((page) => page !== 'mod-info'))(
    '%s keeps a visited missing source in the rebuilt list with its draft',
    async (page) => {
      await mountPage(page);
      await nameInput().setValue('Local');
      const document = wrapper!.getComponent(JsonDocumentEditor).props('document'),
        baseline = document.record.value;
      const navigation = useWorkspaceNavigationActions();
      navigation.showSettings();
      await flushPromises();
      entities.delete(key('s1', JSON_DOCUMENT_DEFINITIONS[page].kind, 'a'));
      mocks.prepare.mockImplementation(async (request: JsonRecoveryRequest) => ({
        request,
        baseVersions: [],
        currentSources: {},
        resourceRefs: {},
        missingPaths: request.origin.kind === 'entity' && request.origin.target.id === 'a' ? ['source.json'] : [],
      }));
      navigation.navigateToModJson('M:/one', page);
      await flushPromises();
      expect(wrapper!.getComponent(JsonDocumentEditor).props('document')).toBe(document);
      const selected = wrapper!.get('.json-entity-list-item.active');
      expect(selected.text()).toContain('Local');
      expect(selected.text()).toContain('未保存');
      expect(selected.text()).toContain('来源缺失');
      expect(wrapper!.text()).toContain('重新创建来源');
      expect(document.record.value).toEqual(baseline);
      expect(await document.undo()).toBe(true);
    },
  );
  it.each(pages.filter((page) => page !== 'mod-info'))(
    '%s creates and selects a document, then deletes it through one confirmation',
    async (page) => {
      const definition = JSON_DOCUMENT_DEFINITIONS[page],
        kind = definition.kind as 'faction' | 'mission' | 'variant' | 'skin';
      mocks.create.mockImplementation(async () => {
        entities.set(key('s1', kind, 'created'), jsonEntityFixture(kind, 'created', 'Created'));
        return { entity: {}, receipt: savedWriteFixture() };
      });
      mocks.remove.mockImplementation(async () => {
        entities.delete(key('s1', kind, 'created'));
        return savedWriteFixture();
      });
      await mountPage(page);
      await nameInput().setValue('Original draft');
      expect(await wrapper!.getComponent(JsonDocumentList).props('create')('created', 'hull')).toBe(true);
      await flushPromises();
      expect(wrapper!.getComponent(JsonDocumentEditor).props('document').target.value!.id).toBe('created');
      await nameInput().setValue('Discarded by explicit delete');
      await wrapper!
        .findAll('button')
        .find((button) => button.text() === '删除')!
        .trigger('click');
      await mocks.feedback.confirmDanger.mock.lastCall![0].onConfirm();
      await flushPromises();
      expect(mocks.feedback.confirmDanger).toHaveBeenCalledOnce();
      expect(mocks.remove).toHaveBeenCalledOnce();
      expect(
        useJsonEditorStore()
          .documentStates('s1')
          .map((document) => document.target.value!.id),
      ).toEqual(['a']);
      expect(wrapper!.getComponent(JsonDocumentEditor).props('document').target.value!.id).toBe('a');
      expect((nameInput().element as HTMLInputElement).value).toBe('Original draft');
    },
  );
  it('keeps one Mission row in index order through successive external and local renames', async () => {
    await mountPage('mission');
    for (const [previous, next] of [
      ['a', 'first'],
      ['first', 'second'],
    ] as const) {
      const before = entities.get(key('s1', 'mission', previous))!,
        after = jsonEntityFixture('mission', next, 'External');
      entities.delete(key('s1', 'mission', previous));
      entities.set(key('s1', 'mission', next), after);
      const result = savedWriteFixture();
      result.commitId = ++serial;
      result.identityChanges = [{ before: before.target, after: after.target }];
      await Promise.all([...mocks.listeners].map((listener) => listener({ sessionId: 's1', modRoot: 'M:/one', result })));
      await flushPromises();
      expect(wrapper!.findAll('.json-entity-list-item').map((item) => item.text())).toEqual([
        expect.stringContaining(next),
        expect.stringContaining('b'),
      ]);
    }
    await wrapper!.findAll('.schema-section input')[1]!.setValue('local');
    await useJsonEditorStore().active!.save();
    await flushPromises();
    expect(wrapper!.findAll('.json-entity-list-item').map((item) => item.text())).toEqual([
      expect.stringContaining('local'),
      expect.stringContaining('b'),
    ]);
  });
});
