import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import JsonEditorWorkspace from './JsonEditorWorkspace.vue';
import JsonDocumentEditor from './JsonDocumentEditor.vue';
import JsonDocumentList from './JsonDocumentList.vue';
import type { EntityIdentityAppliedEvent } from '@/windows/window.events';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { jsonEntityFixture } from '@/test/json-editor';
import { sessionUpdateFixture, savedWriteFixture } from '@/test/write-result';
import { editorUiStubs } from '@/test/ui-stubs';
import { getSchema } from '@/domain/schema/config-schema-registry';
import { JSON_DOCUMENT_DEFINITIONS } from '@/domain/json-editor/json-document-definitions';
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
vi.mock('@/app/composables/use-core-schema', () => ({
  useCoreSchema: () => ({
    loadCoreFields: async () => {},
    getMergedSchema: (kind: string) => ({
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
    }),
  }),
}));
vi.mock('@/services/entity-query.service', async (original) => ({
  ...(await original<typeof import('@/services/entity-query.service')>()),
  querySessionEntityList: mocks.list,
  querySessionEntity: mocks.read,
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
const pages = Object.keys(JSON_DOCUMENT_DEFINITIONS) as JsonEditorPageId[];
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
const nameInput = () => wrapper!.get('.schema-section input');
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
    [...entities.entries()].filter(([id]) => id.startsWith(session + ':' + kind + ':')).map(([, entity]) => entity),
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
  mocks.prepare.mockImplementation(async (request: JsonRecoveryRequest) => ({
    request,
    missingPaths: [],
    currentSources: {},
    baseVersions: [],
  }));
  mocks.feedback.choose.mockResolvedValue('follow');
  mocks.feedback.confirmWarning.mockImplementation((options) => options.onConfirm());
  mocks.previews.mockResolvedValue({ logoSrc: '', crestSrc: '' });
  mocks.slots.mockResolvedValue([]);
});
import { useProjectSyncStore } from '@/stores/project-sync.store';
afterEach(() => {
  wrapper?.unmount();
  useJsonEditorStore().releaseSession('s1');
  useJsonEditorStore().releaseSession('s2');
});
describe('JSON common workspace and form', () => {
  it.each(pages)('%s restores its selection, draft and history after rebuilding its page and switching Mods', async (page) => {
    await mountPage(page);
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
    expect(mocks.slots).toHaveBeenLastCalledWith('s1', 'other_hull', undefined);
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
