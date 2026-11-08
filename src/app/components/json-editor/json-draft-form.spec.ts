import type * as JsonSaveOrchestratorModule from '@/orchestrators/json-save.orchestrator';
import type * as JsonRecoveryServiceModule from '@/services/json-recovery.service';
import type * as HullReferenceServiceModule from '@/services/hull-reference.service';
import type * as JsonEntityServiceModule from '@/services/json-entity.service';
import type * as ImmersiveEditorOrchestratorModule from '@/orchestrators/immersive-editor.orchestrator';
import { dialogText } from '@/test/unit/dialog-text';
import { miscConfigDocumentValue, miscConfigDocumentContent } from '@/domain/json-editor/json-document-definitions';
import { dispatchProjectChangeFixture, committedChangeFixture } from '@/test/unit/project-changes';
import { projectChangeFixture } from '@/test/unit/project-changes';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import JsonEditorPage from './JsonEditorPage.vue';
import { useWorkspaceJsonEditorHost } from '@/app/composables/use-workspace-json-editor-host';
import JsonDocumentEditor from './JsonDocumentEditor.vue';
import JsonDocumentList from './JsonDocumentList.vue';
import { NInput } from 'naive-ui/es/input';
import { NDropdown } from 'naive-ui/es/dropdown';
import type { CommittedWriteEvent, WriteResult } from '@/shared/types';
import SchemaFormRenderer from '@/app/components/field-editor/SchemaFormRenderer.vue';
import SchemaValueInput from '@/app/components/field-editor/SchemaValueInput.vue';
import { miscConfigFixture } from '@/test/fixtures/misc-config';
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
import { editorUiStubs, nInput } from '@/test/unit/ui-stubs';
import { getSchema } from '@/domain/schema/config-schema-registry';

import { JSON_DOCUMENT_DEFINITIONS } from '@/domain/json-editor/json-document-definitions';
import * as miscConfig from '@/domain/misc-config';
import * as sourceCatalog from '@/services/source-catalog.service';
import type { AppFeedback, EntityData, JsonEditorPageId, RowData, JsonRecoveryRequest, IndexedConfigSave } from '@/shared/types';
import type * as EntityQueryServiceModule from '@/services/entity-query.service';
import type * as ProjectSyncOrchestratorModule from '@/orchestrators/project-sync.orchestrator';
import type * as MiscConfigServiceModule from '@/services/misc-config.service';
import { h } from 'vue';
import type { Component, VNode } from 'vue';
import { pauseQueryReads } from '@/app/composables/use-query-read-owner';

vi.mock('@/services/window.service', () => ({ releaseNativeWindowTargets: vi.fn(async () => {}) }));
const mocks = vi.hoisted(() => ({
  listeners: new Set<(event: CommittedWriteEvent) => Promise<void>>(),
  list: vi.fn<typeof EntityQueryServiceModule.querySessionEntityList>(),
  read: vi.fn<typeof EntityQueryServiceModule.querySessionEntity>(),
  saveFile: vi.fn(),
  saveIndexed: vi.fn<typeof JsonSaveOrchestratorModule.saveIndexedEntityAction>(),
  saveMod: vi.fn<typeof JsonSaveOrchestratorModule.saveModInfoAction>(),
  remove: vi.fn(),
  create: vi.fn<(...args: unknown[]) => unknown>(),
  complete: vi.fn(),
  prepare: vi.fn<typeof JsonRecoveryServiceModule.prepareJsonSourceRecovery>(),
  slots: vi.fn<typeof HullReferenceServiceModule.queryBuiltInWeaponSlotOptions>(),
  previews: vi.fn<typeof JsonEntityServiceModule.queryFactionPreviewImages>(),
  missionPreview: vi.fn<typeof JsonEntityServiceModule.queryMissionDraftIcon>(),
  miscRead: vi.fn<typeof MiscConfigServiceModule.queryMiscConfigFile>(),
  miscList: vi.fn<typeof MiscConfigServiceModule.queryMiscConfigFiles>(),
  miscSave: vi.fn<typeof MiscConfigServiceModule.saveMiscConfig>(),
  miscDelete: vi.fn<typeof MiscConfigServiceModule.deleteMiscConfig>(),
  openImmersive: vi.fn<typeof ImmersiveEditorOrchestratorModule.openVariantImmersiveEditor>(),
  hullTarget: vi.fn<typeof EntityQueryServiceModule.querySessionEntityEditTarget>(),
  hullNames: vi.fn(async () => ({ hullNames: {} as Record<string, string> })),
  feedback: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    choose: vi.fn<AppFeedback['choose']>(),
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
  ...(await original<typeof EntityQueryServiceModule>()),
  querySessionEntityList: mocks.list,
  querySessionEntity: mocks.read,
  querySessionEntityEditTarget: mocks.hullTarget,
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async (original) => ({
  ...(await original<typeof ProjectSyncOrchestratorModule>()),
  ...(await import('@/test/unit/project-changes')),
  listenSavedIdentity: async (listener: (event: CommittedWriteEvent) => Promise<void>) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
}));
vi.mock('@/orchestrators/json-save.orchestrator', () => ({
  saveJsonFileAction: (_kind: string, ...args: unknown[]) => mocks.saveFile(...args),
  saveIndexedEntityAction: mocks.saveIndexed,
  saveModInfoAction: mocks.saveMod,
  createJsonFileAction: (_kind: string, ...args: unknown[]) => mocks.create(...args),
  createIndexedEntityAction: mocks.create,
}));
vi.mock('@/services/json-file.service', () => ({ deleteVariantEntity: mocks.remove, deleteSkinEntity: mocks.remove }));
vi.mock('@/services/json-recovery.service', () => ({ prepareJsonSourceRecovery: mocks.prepare }));
vi.mock('@/services/misc-config.service', async (original) => ({
  ...(await original<typeof MiscConfigServiceModule>()),
  queryMiscConfigFiles: mocks.miscList,
  queryMiscConfigFile: mocks.miscRead,
  saveMiscConfig: mocks.miscSave,
  deleteMiscConfig: mocks.miscDelete,
}));
vi.mock('@/services/json-entity.service', () => ({
  deleteIndexedConfigEntity: mocks.remove,
  queryFactionPreviewImages: mocks.previews,
  queryMissionDraftIcon: mocks.missionPreview,
}));
vi.mock('@/services/hull-reference.service', () => ({
  querySessionHullReferences: mocks.hullNames,
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
const stringsFile = { kind: 'strings' as const, path: 'M:/one/data/strings/strings.json', relPath: 'data/strings/strings.json' };
const pages = (Object.keys(JSON_DOCUMENT_DEFINITIONS) as JsonEditorPageId[]).filter((page) => page !== 'misc-config');
const key = (session: string, kind: string, id: string) => [session, kind, id].join(':');
function manifest(session = 's1', root = 'M:/one') {
  const result = sessionUpdateFixture(session, root).content.manifest;
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
async function mountPage(page: JsonEditorPageId, root = 'M:/one', input: Component = nInput) {
  useWorkspaceStore().activateModJson(root, page);
  wrapper = mount(
    {
      setup() {
        const host = useWorkspaceJsonEditorHost();
        return () => {
          const target = host.pageTarget.value;
          return target ? h(JsonEditorPage, { key: JSON.stringify(target), target, host }) : null;
        };
      },
    },
    {
      attachTo: document.body,
      global: { stubs: { ...editorUiStubs, 'n-input': input, 'n-modal': true } },
    },
  );
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

  receipt.baseVersions = after.baseVersions.map((version) => ({ ...version, fingerprint: 'v2' }));
  receipt.identityChanges = [{ before: before.target, after: after.target }];
  entities.delete(key(session, kind, before.id));
  entities.set(key(session, kind, id), { ...after, baseVersions: receipt.baseVersions });
  return {
    ...receipt,
    content: {
      target: { kind: 'json', origin: { kind: 'entity', target: { kind, id, relPath: after.target.write.relPath } } },
      value: { data },
    },
  };
}
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ editMode: 'smart' }));
  vi.clearAllMocks();
  mocks.hullNames.mockResolvedValue({ hullNames: {} });
  mocks.listeners.clear();
  entities = new Map();
  wrapper = null;
  register();
  mocks.list.mockImplementation(async (session: string, kind: string) =>
    [...entities.entries()]
      .filter(([id]) => id.startsWith(session + ':' + kind + ':'))
      .map(([, entity]) => (entity.kind === 'mission' ? { ...entity, data: { list: (entity.data as RowData).list! } } : entity)),
  );
  mocks.read.mockImplementation(async (session: string, kind: string, id: string) => entities.get(key(session, kind, id)) ?? null);
  mocks.saveFile.mockImplementation(async (...args: Parameters<typeof savedFile>) => savedFile(...args));
  mocks.saveIndexed.mockImplementation(async (write: IndexedConfigSave) => {
    const before = entities.get(key(write.sessionId, write.kind, write.previousId!))!,
      after = jsonEntityFixture(write.kind, write.nextId, 'Written', write.modRoot);
    after.data = write.kind === 'faction' ? write.entityData.file! : { ...write.entityData, list: write.indexRow };
    const receipt = savedWriteFixture();

    receipt.baseVersions = after.baseVersions;
    receipt.identityChanges = [{ before: before.target, after: after.target }];
    entities.delete(key(write.sessionId, write.kind, before.id));
    entities.set(key(write.sessionId, write.kind, after.id), after);
    return {
      ...receipt,
      content: {
        target: {
          kind: 'json',
          origin: { kind: 'entity', target: { kind: write.kind, id: write.nextId, relPath: after.target.write.relPath } },
        },
        value: {
          entityId: write.nextId,
          indexPath: write.modRoot + (write.kind === 'faction' ? '/data/world/factions/factions.csv' : '/data/missions/mission_list.csv'),
          indexHeader: [],
          entityData: write.entityData,
          indexRows: [{ data: write.indexRow, isComment: false }],
        },
      },
    };
  });
  mocks.complete.mockImplementation(async (modRoot: string, _session: string, result: WriteResult) => {
    await dispatchProjectChangeFixture(committedChangeFixture(result, _session, modRoot));
  });
  mocks.prepare.mockImplementation(
    async (request: JsonRecoveryRequest): ReturnType<typeof JsonRecoveryServiceModule.prepareJsonSourceRecovery> => {
      if (request.origin.kind === 'entity') {
        const entity = entities.get(key(request.sessionId, request.origin.target.kind, request.origin.target.id))!;
        const data = entity.data as RowData;
        return {
          request,
          missingPaths: [],
          baseVersions: entity.baseVersions,
          currentSources:
            entity.kind === 'mission'
              ? { descriptor: data.descriptor!, text: data.text!, index: { rows: [{ isComment: false, data: data.list! }] } }
              : { file: data },
          resourceRefs: entity.resourceRefs,
        };
      }
      const source = useProjectStore().getManifest(request.modRoot)!;
      return { request, missingPaths: [], baseVersions: source.baseVersions, currentSources: { file: source.modInfo! }, resourceRefs: {} };
    },
  );
  mocks.feedback.choose.mockImplementation(async (options) => options.choices[0]?.value ?? null);
  mocks.feedback.confirmWarning.mockImplementation((options) => {
    void options.onConfirm();
  });
  mocks.previews.mockResolvedValue({ logoSrc: '', crestSrc: '' });
  mocks.missionPreview.mockResolvedValue('');
  mocks.slots.mockResolvedValue([]);
  mocks.miscList.mockResolvedValue([{ ...stringsFile, state: 'missing', error: null }]);
  mocks.miscRead.mockResolvedValue(null);
});
afterEach(() => {
  wrapper?.unmount();
  useJsonEditorStore().releaseSession('s1');
  useJsonEditorStore().releaseSession('s2');
  vi.restoreAllMocks();
});
describe('JSON common workspace and form', () => {
  it.each(['variants', 'skins', 'factions', 'mission', 'misc-config'] as const)(
    '%s selects and opens its first record after a paused initial list is replayed',
    async (page) => {
      mocks.hullNames.mockResolvedValue({ hullNames: { hull: 'Resumed hull' } });
      const releases: Array<() => void> = [];
      if (page === 'misc-config') {
        mocks.miscList.mockImplementation(
          () =>
            new Promise((resolve) => {
              releases.push(() => resolve([{ ...stringsFile, state: 'missing', error: null }]));
            }),
        );
      } else {
        const kind = ({ variants: 'variant', skins: 'skin', factions: 'faction', mission: 'mission' } as const)[page];
        mocks.list.mockImplementation(
          () =>
            new Promise((resolve) => {
              releases.push(() => resolve(['a', 'b'].map((id) => jsonEntityFixture(kind, id, 'Resumed fixture'))));
            }),
        );
      }
      await mountPage(page);
      const resume = pauseQueryReads();
      onTestFinished(async () => {
        await resume();
        wrapper?.unmount();
        releases.forEach((release) => release());
        await flushPromises();
      });
      await flushPromises();
      await resume();
      await flushPromises();
      expect(releases).toHaveLength(2);
      releases.forEach((release) => release());
      await flushPromises();
      const list = wrapper!.getComponent(JsonDocumentList);
      expect(list.props('loading')).toBe(false);
      expect(list.props('selectedId')).toBe(page === 'misc-config' ? 'strings' : 'a');
      expect(list.find('.json-entity-list-item.active').exists()).toBe(true);
      if (page === 'misc-config') expect(wrapper!.get('.empty-state button').text()).toBe('创建文件');
      else expect(useJsonEditorStore().active!.target.value!.id).toBe('a');
      if (page === 'variants') expect(list.find('.json-entity-list-item.active').text()).toContain('Resumed hull');
    },
  );
  it('shows the list loader replay after a cancelled window close', async () => {
    const releases: Array<() => void> = [];
    mocks.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve([]));
        }),
    );
    await mountPage('variants');
    const list = wrapper!.getComponent(JsonDocumentList),
      resume = pauseQueryReads();
    onTestFinished(async () => {
      await resume();
      wrapper?.unmount();
      releases.forEach((release) => release());
      await flushPromises();
    });
    await flushPromises();
    expect(list.props('loading')).toBe(false);
    await resume();
    await flushPromises();
    expect(list.props('loading')).toBe(true);
    expect(releases).toHaveLength(2);
    releases.forEach((release) => release());
    await flushPromises();
    expect(list.props('loading')).toBe(false);
    expect(list.text()).toContain('未找到');
  });
  it.each(['variants', 'skins', 'factions', 'mission'] as const)(
    '%s distinguishes initial reading, failure and an empty retry result',
    async (page) => {
      let fail!: (error: Error) => void;
      mocks.list.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
      onTestFinished(async () => {
        wrapper?.unmount();
        fail(new Error('Released list'));
        await flushPromises();
      });
      await mountPage(page);
      const list = wrapper!.getComponent(JsonDocumentList);
      expect(list.get('.json-entity-list-count').text()).toBe('正在读取…');
      expect(list.text()).not.toContain('未找到');
      fail(new Error('List fixture'));
      await flushPromises();
      expect(list.get('[role="alert"]').text()).toContain('List fixture');
      expect(list.text()).not.toContain('未找到');
      expect(list.props('loading')).toBe(false);
      mocks.list.mockResolvedValueOnce([]);
      await list.get('[role="alert"] button').trigger('click');
      await flushPromises();
      expect(list.find('[role="alert"]').exists()).toBe(false);
      expect(list.text()).toContain('未找到');
      expect(mocks.list).toHaveBeenCalledTimes(2);
    },
  );
  it.each(['variants', 'skins', 'factions', 'mission'] as const)(
    '%s retains list nodes, focus and raw input through a failed refresh and retry',
    async (page) => {
      await mountPage(page);
      const list = wrapper!.getComponent(JsonDocumentList),
        field = nameInput(),
        row = list.get('[data-entity-id="a"]').element;
      field.element.focus();
      await field.setValue('Raw draft');
      const document = useJsonEditorStore().active!,
        commit = vi.spyOn(document.inputs, 'commit');
      let fail!: (error: Error) => void;
      mocks.list.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
      const work = projectChangeFixture('s1', {
        ...savedWriteFixture().invalidation,
        queryScopes: [
          {
            kind: 'entity-list',
            entity: { kind: ({ variants: 'variant', skins: 'skin', factions: 'faction', mission: 'mission' } as const)[page], id: '' },
            table: null,
            source: null,
            resource: null,
          },
        ],
      });
      const failed = expect(work).rejects.toThrow('Refresh fixture');
      onTestFinished(async () => {
        wrapper?.unmount();
        fail(new Error('Refresh fixture'));
        await failed;
      });
      await flushPromises();
      expect(list.props('loading')).toBe(true);
      expect(list.get('[data-entity-id="a"]').element).toBe(row);
      expect(nameInput().element).toBe(field.element);
      expect(field.element.disabled).toBe(false);
      fail(new Error('Refresh fixture'));
      await failed;
      await flushPromises();
      expect(list.get('[role="alert"]').text()).toContain('Refresh fixture');
      await list.get('[role="alert"] button').trigger('click');
      await flushPromises();
      expect(list.find('[role="alert"]').exists()).toBe(false);
      expect(list.get('[data-entity-id="a"]').element).toBe(row);
      expect(useJsonEditorStore().active).toBe(document);
      expect(field.element.value).toBe('Raw draft');
      expect(globalThis.document.activeElement).toBe(field.element);
      expect(commit).not.toHaveBeenCalled();
      expect(mocks.list).toHaveBeenCalledTimes(3);
    },
  );
  it('marks the requested list item while waiting for its current input to finish', async () => {
    await mountPage('variants');
    const list = wrapper!.getComponent(JsonDocumentList),
      editor = wrapper!.getComponent(JsonDocumentEditor);
    let finish!: (value: boolean) => void;
    const wait = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    onTestFinished(async () => {
      finish(true);
      await wait;
      await flushPromises();
    });
    vi.spyOn(useJsonEditorStore().active!.inputs, 'commit').mockReturnValueOnce(wait);
    await list.get('[data-entity-id="b"]').trigger('click');
    expect(list.get('[data-entity-id="b"]').text()).toContain('正在交接');
    expect(wrapper!.getComponent(JsonDocumentEditor).vm.$.uid).toBe(editor.vm.$.uid);
    expect(list.props('selectedId')).toBe('a');
    finish(true);
    await flushPromises();
    expect(list.text()).not.toContain('正在交接');
    expect(list.props('selectedId')).toBe('b');
  });
  it.each(pages)('%s retains editor, form, input, focus and scroll through ordinary edits', async (page) => {
    mocks.previews.mockResolvedValue({ logoSrc: 'logo-image', crestSrc: 'crest-image' });
    mocks.missionPreview.mockResolvedValue('mission-image');
    await mountPage(page);
    const editor = wrapper!.getComponent(JsonDocumentEditor),
      form = editor.getComponent(SchemaFormRenderer);
    const input = nameInput(),
      scroll = editor.get('.editor-fields').element;
    const images = editor.findAll('.json-image-preview img').map((image) => image.element);
    const counts = [
      mocks.previews.mock.calls.length,
      mocks.missionPreview.mock.calls.length,
      mocks.read.mock.calls.length,
      mocks.list.mock.calls.length,
    ];
    scroll.scrollTop = 137;
    input.element.focus();
    for (const value of ['First', 'Second', 'Third']) {
      await input.setValue(value);
      await useJsonEditorStore().active!.inputs.commit();
      if (page === 'factions' || page === 'mission') {
        const doc = editor.props('document'),
          source = page === 'factions' ? 'file' : 'descriptor';
        doc.draftValue.value = {
          ...doc.draftValue.value,
          [source]: { ...(doc.draftValue.value[source] as RowData), [page === 'factions' ? 'icon' : 'logo']: value },
        };
      }
      await flushPromises();
      expect(wrapper!.getComponent(JsonDocumentEditor).vm.$.uid).toBe(editor.vm.$.uid);
      expect(editor.getComponent(SchemaFormRenderer).vm.$.uid).toBe(form.vm.$.uid);
      expect(nameInput().element).toBe(input.element);
      expect(document.activeElement).toBe(input.element);
      expect(scroll.scrollTop).toBe(137);
      expect(editor.findAll('.json-image-preview img').map((image) => image.element)).toEqual(images);
      expect([
        mocks.previews.mock.calls.length,
        mocks.missionPreview.mock.calls.length,
        mocks.read.mock.calls.length,
        mocks.list.mock.calls.length,
      ]).toEqual(counts);
    }
  });
  it.each(['factions', 'mission'] as const)(
    '%s updates image sources without replacing nodes and rejects obsolete results',
    async (page) => {
      const faction = page === 'factions';
      const query = vi.fn<() => Promise<string>>();
      mocks.previews.mockImplementation(async () => {
        const value = await query();
        return { logoSrc: value, crestSrc: value };
      });
      mocks.missionPreview.mockImplementation(query);
      const resource = {
        source: 'mod' as const,
        relPath: 'graphics/preview.png',
        ownerKind: faction ? ('faction' as const) : ('mission' as const),
        ownerId: 'a',
        key: faction ? 'logo' : 'icon',
      };
      entities.get(key('s1', faction ? 'faction' : 'mission', 'a'))!.resourceRefs = { preview: resource };
      query.mockResolvedValue('original-image');
      await mountPage(page);
      const editor = wrapper!.getComponent(JsonDocumentEditor),
        doc = editor.props('document');
      const image = editor.get('.json-image-preview img').element;
      const panel = image.closest('.panel-card'),
        scroll = editor.get('.editor-fields').element;
      scroll.scrollTop = 137;
      const initialCalls = query.mock.calls.length;
      await projectChangeFixture('s1', {
        ...savedWriteFixture().invalidation,
        resources: [{ source: 'mod', relPath: 'graphics/unrelated.png' }],
      });
      await flushPromises();
      expect(query).toHaveBeenCalledTimes(initialCalls);
      query.mockResolvedValueOnce('refreshed-image');
      await projectChangeFixture('s1', { ...savedWriteFixture().invalidation, resources: [resource] });
      await flushPromises();
      expect(query).toHaveBeenCalledTimes(initialCalls + 1);
      expect(editor.get('.json-image-preview img').element).toBe(image);
      expect(image.getAttribute('src')).toBe('refreshed-image');
      const update = async (path: string) => {
        const key = faction ? 'file' : 'descriptor';
        doc.draftValue.value = {
          ...doc.draftValue.value,
          [key]: { ...(doc.draftValue.value[key] as RowData), [faction ? 'logo' : 'icon']: path },
        };
        await flushPromises();
      };
      let finishOld!: (value: string) => void, finishNew!: (value: string) => void;
      const calls = query.mock.calls.length;
      query.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      );
      await update('graphics/old.png');
      expect(image.getAttribute('src')).toBe('refreshed-image');
      expect(editor.get('.panel-card').element).toBe(panel);
      query.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = resolve;
          }),
      );
      await update('graphics/new.png');
      finishNew('new-image');
      await flushPromises();
      finishOld('obsolete-image');
      await flushPromises();
      expect(query).toHaveBeenCalledTimes(calls + 2);
      expect(editor.get('.json-image-preview img').element).toBe(image);
      expect(image.getAttribute('src')).toBe('new-image');
      query.mockRejectedValueOnce(new Error('image read failed'));
      await update('graphics/failed.png');
      expect(image.getAttribute('src')).toBe('new-image');
      expect(mocks.feedback.error).toHaveBeenCalledWith(expect.any(Error), '刷新 JSON 预览失败');
      query.mockResolvedValueOnce('');
      await update('');
      expect(editor.find('.json-image-preview img').element).toBe(image);
      expect(editor.find('.panel-card').element).toBe(panel);
      expect((panel as HTMLElement).style.display).toBe('none');
      query.mockResolvedValueOnce('restored-image');
      await update('graphics/restored.png');
      expect(editor.get('.json-image-preview img').element).toBe(image);
      expect(image.getAttribute('src')).toBe('restored-image');
      expect(scroll.scrollTop).toBe(137);
      query.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      );
      await update('graphics/late.png');
      await wrapper!.getComponent(JsonDocumentList).get('[data-entity-id="b"]').trigger('click');
      await flushPromises();
      const next = wrapper!.getComponent(JsonDocumentEditor);
      finishOld('late-image');
      await flushPromises();
      expect(next.props('document').target.value!.id).toBe('b');
      expect(next.text()).not.toContain('late-image');
      expect(next.get('.json-image-preview img').attributes('src')).toBe('original-image');
    },
  );
  it.each(['variants', 'skins', 'factions', 'mission', 'misc-config'] as const)('%s filters its displayed summaries', async (page) => {
    await mountPage(page);
    const list = wrapper!.getComponent(JsonDocumentList),
      total = list.props('items').length;
    const input = list.get('.json-entity-list-search input');
    const text = page === 'misc-config' ? ' STRINGS.JSON ' : ' B ';
    for (const field of ['id-name', 'id', 'name'] as const) {
      const query = field === 'name' ? (page === 'misc-config' ? '文本' : ' SAVED ') : text;
      await list.props('setSearch')(query, field);
      await flushPromises();
      const count = field === 'name' && page !== 'mission' && page !== 'misc-config' ? 2 : 1;
      expect(list.findAll('.json-entity-list-item')).toHaveLength(count);
      expect(list.get('.json-entity-list-count').text()).toBe(count + '/' + total + ' 项');
    }
    await input.setValue('unmatched');
    await flushPromises();
    expect(list.text()).toContain('没有匹配项');
    expect(list.props('selectedId')).toBe(page === 'misc-config' ? 'strings' : 'a');
    await input.setValue('   ');
    await flushPromises();
    expect(list.findAll('.json-entity-list-item')).toHaveLength(total);
    expect(list.get('.json-entity-list-count').text()).toBe(total + ' 项');
  });
  it('commits draft names and IDs for filtering, keeps the editor and selects a result', async () => {
    await mountPage('variants');
    const list = wrapper!.getComponent(JsonDocumentList),
      editor = useJsonEditorStore().active!;
    await nameInput().setValue('Local');
    await wrapper!.findAll('.schema-section input')[1]!.setValue('draft_id');
    await list.props('setSearch')('DRAFT_ID', 'id');
    await flushPromises();
    expect(list.get('.json-entity-list-item').text()).toContain('Local');
    await list.props('setSearch')('Local', 'name');
    await flushPromises();
    expect(list.findAll('.json-entity-list-item')).toHaveLength(1);
    await list.props('setSearch')('b', 'id');
    await flushPromises();
    expect(useJsonEditorStore().active).toBe(editor);
    expect(nameInput().element.value).toBe('Local');
    await list.get('[data-entity-id="b"]').trigger('click');
    await flushPromises();
    expect(useJsonEditorStore().active!.target.value!.id).toBe('b');
    expect(editor.dirty.value).toBe(true);
  });
  it('retains filtering across refresh, same-page returns and Mods, and resets it on another JSON page or release', async () => {
    await mountPage('variants');
    const list = wrapper!.getComponent(JsonDocumentList),
      navigation = useWorkspaceNavigationActions(),
      editors = useJsonEditorStore();
    await list.props('setSearch')('b', 'id');
    void projectChangeFixture('s1', {
      ...savedWriteFixture().invalidation,
      queryScopes: [{ kind: 'entity-list', entity: { kind: 'variant', id: '' }, table: null, source: null, resource: null }],
    });
    await flushPromises();
    expect(list.get('.json-entity-list-item').attributes('data-entity-id')).toBe('b');
    navigation.showSettings();
    await flushPromises();
    for (const root of ['M:/one', 'M:/two', 'M:/one']) {
      navigation.navigateToModJson(root, 'variants');
      await flushPromises();
      expect(wrapper!.getComponent(JsonDocumentList).props('search')).toMatchObject({
        text: root === 'M:/one' ? 'b' : '',
        field: root === 'M:/one' ? 'id' : 'id-name',
      });
    }
    navigation.navigateToModJson('M:/one', 'skins');
    await flushPromises();
    expect(wrapper!.getComponent(JsonDocumentList).props('search')).toMatchObject({ text: '', field: 'id-name' });
    wrapper!.unmount();
    editors.releaseSession('s1');
    expect(editors.search('s1', 'variant')).toMatchObject({ text: '', field: 'id-name' });
  });
  it('retains invalid input, focus and search when submission fails', async () => {
    initializeSettingsStore(createSettingsFixture({ editMode: 'plain' }));
    await mountPage('variants');
    const field = wrapper!.get('[data-field-path="settings"] textarea');
    await field.setValue('{invalid');
    await wrapper!.getComponent(JsonDocumentList).props('setSearch')('b', 'id');
    expect(wrapper!.getComponent(JsonDocumentList).props('search')).toMatchObject({ text: '', field: 'id-name' });
    expect((field.element as HTMLTextAreaElement).value).toBe('{invalid');
    expect(document.activeElement).toBe(field.element);
    expect(mocks.feedback.error).toHaveBeenCalledOnce();
  });
  it.each(['page', 'mod', 'unmount'] as const)('rejects a filter waiting for saves after %s changes', async (change) => {
    await mountPage('variants');
    let finish!: (value: boolean) => void;
    vi.spyOn(useSaveCommandStore(), 'waitForSaves').mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    const list = wrapper!.getComponent(JsonDocumentList),
      state = list.props('search');
    const pending = list.props('setSearch')('late', 'name');
    if (change === 'unmount') wrapper!.unmount();
    else useWorkspaceStore().activateModJson(change === 'mod' ? 'M:/two' : 'M:/one', 'skins');
    await flushPromises();
    finish(true);
    await pending;
    expect(state).toMatchObject({ text: '', field: 'id-name' });
  });
  it('uses an arrow menu with a checked search field and preserves the keyword', async () => {
    await mountPage('variants', 'M:/one', NInput);
    const list = wrapper!.getComponent(JsonDocumentList);
    expect(list.getComponent(NInput).props('clearable')).toBe(true);
    await list.get('input').setValue('b');
    await flushPromises();
    await list.get('[aria-label="选择搜索项"]').trigger('click');
    const menu = list.getComponent(NDropdown);
    expect(menu.props('options')!.map((option) => option.label)).toEqual(['ID/名称', 'ID', '名称']);
    menu.vm.$emit('select', 'id');
    await flushPromises();
    expect(menu.props('value')).toBe('id');
    expect(document.querySelectorAll('.n-dropdown-menu .json-entity-icon')).toHaveLength(1);
    expect(list.get('input').element.value).toBe('b');
    expect(list.get('input').attributes('placeholder')).toBe('搜索 ID');
    await list.get('input').trigger('focus');
    await list.get('.n-base-clear__clear').trigger('click');
    await flushPromises();
    expect(list.findAll('.json-entity-list-item')).toHaveLength(2);
    expect(list.get('input').element.value).toBe('');
  });
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
    expect(useCsvEditorStore().getCsvModState('M:/one')!.currentTab).toBe('ships');
    expect(useWorkspaceStore().entityLocation).toMatchObject({
      sessionId: 's1',
      modRoot: 'M:/one',
      kind: 'ship',
      id: 'hull',
      rowKey: 'ship-row',
    });
  });
  it.each(['core', 'reference'] as const)('keeps the skin page and explains a %s base hull', async (source) => {
    mocks.hullTarget.mockResolvedValueOnce({
      target: {
        kind: 'ship',
        id: 'hull',
        source: { source, root: 'M:/game', relPath: 'data/hulls/ship_data.csv', path: 'M:/game/data/hulls/ship_data.csv' },
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
    expect(mocks.feedback.info).toHaveBeenCalledExactlyOnceWith(
      '船体「hull」来自' + (source === 'core' ? '原版' : '其他 Mod') + '。',
      'M:/game/data/hulls/ship_data.csv',
    );
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
      ...miscConfig.miscConfigDefinition('strings'),
      schema: 'faction',
      initial: { id: 'fixture', displayName: 'Defined', unknown: '001' },
    };
    vi.spyOn(miscConfig, 'miscConfigDefinition').mockReturnValue(definition);
    let saved = false;
    const path = 'M:/one/data/strings/strings.json';
    mocks.miscList.mockImplementation(async () => [{ ...stringsFile, state: saved ? 'present' : 'missing', error: null }]);
    mocks.miscRead.mockImplementation(async () => ({
      ...stringsFile,
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
      return { ...savedWriteFixture() };
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
    const projected = miscConfigDocumentValue(['001', { value: '123' }]);
    expect(miscConfigDocumentContent(projected)).toEqual(['001', { value: '123' }]);
  });
  it('preserves parse diagnostics and separates failure from a missing registered file', async () => {
    const error = {
      code: 'parse.json_syntax',
      message: 'invalid syntax',
      location: { path: 'M:/one/data/strings/strings.json', line: 3, column: 2 },
    };
    mocks.miscRead.mockRejectedValueOnce(error);
    mocks.miscList.mockResolvedValue([{ ...stringsFile, state: 'present', error: null }]);
    await mountPage('misc-config');
    expect(wrapper!.get('.empty-state').text()).toContain('第 3 行，第 2 列');
    expect(wrapper!.find('.json-entity-list-footer').exists()).toBe(false);
    await wrapper!
      .findAll('.empty-state button')
      .find((button) => button.text() === '修复文件')!
      .trigger('click');
    expect(mocks.feedback.error.mock.lastCall![0]).toBe(error);
    expect(mocks.miscSave).not.toHaveBeenCalled();
    mocks.miscRead.mockResolvedValue({ ...stringsFile, data: {}, baseVersions: [{ path: error.location.path, fingerprint: 'fixed' }] });
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
    mocks.miscList.mockImplementation(async () => [{ ...stringsFile, path, state: exists ? 'present' : 'missing', error: null }]);
    mocks.miscRead.mockImplementation(async () =>
      exists ? { ...stringsFile, data: {}, baseVersions: [{ path, fingerprint: 'v1' }] } : null,
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
      return { ...savedWriteFixture(), baseVersions: [{ path, fingerprint: 'v1' }] };
    });
    mocks.miscDelete.mockImplementation(async () => {
      exists = false;
      return { ...savedWriteFixture() };
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
    expect(mocks.feedback.choose).toHaveBeenCalledOnce();
    await flushPromises();
    await flushPromises();
    expect(mocks.miscDelete).toHaveBeenCalledOnce();
    expect(wrapper!.findComponent(JsonDocumentEditor).exists()).toBe(false);
    expect(wrapper!.get('.json-entity-list-item.active').text()).toContain('未创建');
    expect(wrapper!.get('.empty-state button').text()).toBe('创建文件');
    expect(useJsonEditorStore().documentStates('s1')).toHaveLength(0);
  });
  it.each(['success', 'failure'] as const)('rejects late file %s after switching Mod and returning to the same file', async (outcome) => {
    let resolve!: (value: Awaited<ReturnType<typeof MiscConfigServiceModule.queryMiscConfigFile>>) => void, reject!: (error: Error) => void;
    mocks.miscList.mockResolvedValue([{ ...stringsFile, state: 'present', error: null }]);
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
      ...stringsFile,
      path: path,
      data: { group: { line: 'current' } },
      baseVersions: [{ path, fingerprint: 'v1' }],
    });
    useWorkspaceNavigationActions().navigateToModJson('M:/two', 'misc-config');
    await flushPromises();
    const current = useJsonEditorStore().active!;
    if (outcome === 'success') resolve({ ...stringsFile, path: path, data: { group: { line: 'late' } }, baseVersions: [] });
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
      const result = await useSaveCommandStore().requestSave(handles[0]!);
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
    if (page === 'factions')
      host.props('document').record.value.target.entity!.linkedRecord = {
        kind: 'index',
        path: 'data/world/factions/factions.csv',
        rowIndex: 0,
      };
    const remove = vi.fn(async () => true);
    const editor = mount(JsonDocumentEditor, { props: { ...host.props(), remove }, global: { stubs: editorUiStubs } });
    for (const removeSource of [false, true]) {
      let finish!: (value: string) => void;
      mocks.feedback.choose.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await editor
        .findAll('button')
        .find((button) => button.text() === '删除')!
        .trigger('click');
      const confirmation = mocks.feedback.choose.mock.lastCall![0];
      const content = mount({ render: confirmation.content as () => VNode }, { global: { stubs: editorUiStubs } });
      const selection = content.get('select');
      await selection.setValue(JSON.stringify(removeSource ? 'delete' : 'keep'));
      expect(confirmation.choices[0]!.label).toBe(
        removeSource ? (page === 'mission' ? '移除登记并删除目录' : '移除登记并删除文件') : '移除登记',
      );
      finish('delete');
      await flushPromises();
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
  it.each(
    (['skins', 'variants'] as const).flatMap((page) =>
      (['discard', 'delete'] as const).flatMap((action) => [false, true].map((empty) => ({ page, action, empty }))),
    ),
  )('$page releases an externally deleted source through $action with empty=$empty', async ({ page, action, empty }) => {
    const kind = page === 'skins' ? 'skin' : 'variant';
    if (empty) entities.delete(key('s1', kind, 'b'));
    await mountPage(page);
    if (!empty) await nameInput().setValue('Local');
    const editor = useJsonEditorStore().active!;
    const prepare = mocks.prepare.getMockImplementation()!;
    entities.delete(key('s1', kind, 'a'));
    mocks.prepare.mockImplementation(async (request: JsonRecoveryRequest) =>
      request.origin.kind === 'entity' && request.origin.target.id === 'a'
        ? { request, baseVersions: [], currentSources: {}, resourceRefs: {}, missingPaths: ['source.json'] }
        : prepare(request),
    );
    void projectChangeFixture('s1', {
      ...savedWriteFixture().invalidation,
      queryScopes: [{ kind: 'entity-detail', entity: { kind, id: 'a' }, table: null, source: null, resource: null }],
    });
    await flushPromises();
    expect(mocks.prepare.mock.lastCall?.[0].origin).toMatchObject({ kind: 'entity', target: { kind, id: 'a' } });
    expect(wrapper!.getComponent(JsonDocumentEditor).props('document').sourceMissing.value).toBe(true);
    expect(wrapper!.text()).toContain('来源不完整');
    mocks.feedback.confirmWarning.mockImplementation(() => {});
    const error = new Error('list unavailable');
    mocks.list.mockRejectedValueOnce(error);
    await wrapper!
      .findAll('button')
      .find((button) => button.text() === (action === 'discard' ? '放弃编辑并继续' : '删除'))!
      .trigger('click');
    await flushPromises();
    if (action === 'discard') {
      expect(mocks.feedback.confirmWarning).toHaveBeenCalledOnce();
      mocks.feedback.confirmWarning.mock.lastCall![0].onCancel!();
      await flushPromises();
      expect(useJsonEditorStore().active).toBe(editor);
      expect(editor.dirty.value).toBe(!empty);
      await wrapper!
        .findAll('button')
        .find((button) => button.text() === '放弃编辑并继续')!
        .trigger('click');
      await flushPromises();
      void mocks.feedback.confirmWarning.mock.lastCall![0].onConfirm();
    } else {
      expect(dialogText(mocks.feedback.choose.mock.lastCall![0])).toContain('源文件已缺失');
      await flushPromises();
      expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
    }
    await flushPromises();
    expect(useJsonEditorStore().active).toBe(editor);
    expect(wrapper!.find('[data-entity-id="a"]').exists()).toBe(true);
    expect(mocks.feedback.error).toHaveBeenCalledExactlyOnceWith(error, '加载' + JSON_DOCUMENT_DEFINITIONS[page].label + '失败');
    mocks.feedback.error.mockClear();
    await wrapper!
      .findAll('button')
      .find((button) => button.text() === (action === 'discard' ? '放弃编辑并继续' : '删除'))!
      .trigger('click');
    await flushPromises();
    if (action === 'discard') void mocks.feedback.confirmWarning.mock.lastCall![0].onConfirm();
    else await flushPromises();
    await flushPromises();
    expect(wrapper!.find('[data-entity-id="a"]').exists()).toBe(false);
    expect(
      useJsonEditorStore()
        .documentStates('s1')
        .map((document) => document.target.value!.id),
    ).toEqual(empty ? [] : ['b']);
    expect(useJsonEditorStore().active?.target.value?.id ?? null).toBe(empty ? null : 'b');
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.feedback.error).not.toHaveBeenCalled();
    if (action === 'delete') expect(mocks.feedback.success).toHaveBeenCalledOnce();
  });
  it.each(pages.filter((page) => page !== 'mod-info'))(
    '%s creates and selects a document, then deletes it through one confirmation',
    async (page) => {
      const definition = JSON_DOCUMENT_DEFINITIONS[page],
        kind = definition.kind as 'faction' | 'mission' | 'variant' | 'skin';
      mocks.create.mockImplementation(async () => {
        entities.set(key('s1', kind, 'created'), jsonEntityFixture(kind, 'created', 'Created'));
        return savedWriteFixture();
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
      await flushPromises();
      await flushPromises();
      expect(mocks.feedback.choose).toHaveBeenCalledOnce();
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

      result.identityChanges = [{ before: before.target, after: after.target }];
      await Promise.all(
        [...mocks.listeners].map((listener) =>
          listener({ originWindowLabel: 'peer', reason: 'save', sessionId: 's1', modRoot: 'M:/one', result }),
        ),
      );
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

describe('composed JSON detail adoption', () => {
  it.each(miscConfig.MISC_CONFIG_DEFINITIONS)('$kind displays and saves its local file through navigation', async (definition) => {
    vi.spyOn(sourceCatalog, 'querySourceOptionCatalog').mockResolvedValue([]);
    const data = miscConfigFixture(definition.kind);
    const path = 'M:/one/' + definition.path;
    const baseVersions = [{ path, fingerprint: 'local' }];
    const file = { kind: definition.kind, path, relPath: definition.path, data, baseVersions };
    const composition = {
      replace: false,
      excluded: [],
      layers: (['core', 'reference'] as const).map((source) => ({
        source: { source, root: source, path: source + '/' + definition.path, relPath: definition.path },
        version: { path: source + '/' + definition.path, fingerprint: source },
        data: { inherited_group: { line: source } },
        replace: false,
      })),
    };
    mocks.miscList.mockResolvedValue([{ ...file, state: 'present', error: null }]);
    mocks.miscRead.mockImplementation(async () => ({ ...file, composition }));
    mocks.prepare.mockImplementation(async (request) => ({
      request,
      baseVersions,
      currentSources: { file: file.data },
      missingPaths: [],
      resourceRefs: {},
    }));
    mocks.miscSave.mockImplementation(async (input) => {
      file.data = input.data as RowData;
      return { ...savedWriteFixture(file.data, { kind: 'json', origin: { kind: 'miscConfig', file: definition.kind } }), baseVersions };
    });
    await mountPage('misc-config');
    wrapper!.getComponent(JsonDocumentList).vm.$emit('select', definition.kind);
    await flushPromises();
    const doc = useJsonEditorStore().active!;
    const root = () => wrapper!.getComponent(SchemaValueInput);
    const assertLocal = (expected: RowData) => {
      expect(root().props('value')).toEqual(expected);
      expect(wrapper!.getComponent(SchemaFormRenderer).props('runtimeContext')!.composition).toBeUndefined();
      expect(wrapper!.find('.editor-fields > .ui-text-muted').exists()).toBe(false);
    };
    assertLocal(data);
    const updated = structuredClone(data);
    delete updated[Object.keys(updated)[0]!];
    root().vm.$emit('update', { kind: 'set', value: updated });
    await flushPromises();
    assertLocal(updated);
    expect(await doc.undo()).toBe(true);
    await flushPromises();
    assertLocal(data);
    expect(await doc.redo()).toBe(true);
    await flushPromises();
    expect(wrapper!.getComponent(JsonDocumentEditor).props('document').problems.issues.value).toEqual([]);
    expect((await doc.save()).status).toBe('saved');
    expect(mocks.miscSave.mock.lastCall![0].data).toEqual(updated);
    expect(doc.dirty.value).toBe(false);
    const navigation = useWorkspaceNavigationActions();
    navigation.showSettings();
    await flushPromises();
    navigation.navigateToModJson('M:/one', 'misc-config');
    await flushPromises();
    expect(useJsonEditorStore().active).toBe(doc);
    assertLocal(updated);
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });

  it('loads one faction detail with sparse local content and saves it through the form', async () => {
    const entity = entities.get(key('s1', 'faction', 'a'))!;
    entity.data = { knownShips: {} };
    entity.baseVersions.unshift({ path: 'M:/one/data/world/factions/factions.csv', fingerprint: 'index' });
    entity.composition = { layers: [], excluded: [], replace: false };
    await mountPage('factions');
    const doc = useJsonEditorStore().active!;
    expect(mocks.read.mock.calls.map((call) => call.slice(0, 3))).toEqual([['s1', 'faction', 'a']]);
    const renderer = wrapper!.getComponent(SchemaFormRenderer);
    expect(renderer.props('runtimeContext')!.partial).toBe(true);
    expect(wrapper!.get('.editor-header .page-path').text()).toBe(entity.target.write.relPath);
    expect(wrapper!.get('.editor-fields > .ui-text-muted').text()).toBe('待组合文件');
    await nameInput().setValue('Saved override');
    expect((await doc.save()).status).toBe('saved');
    expect(mocks.saveIndexed.mock.lastCall![0].entityData.file).toEqual({ knownShips: {}, displayName: 'Saved override' });
    expect(mocks.feedback.choose).not.toHaveBeenCalled();
    expect(doc.dirty.value).toBe(false);
    expect(renderer.props('runtimeContext')!.composition).toBeDefined();
    await wrapper!.findAll('.schema-section input')[1]!.setValue('local');
    await doc.inputs.commit();
    expect(wrapper!.get('.editor-fields > .ui-text-muted').text()).toBe('完整定义文件');
    await doc.undo();
    expect(wrapper!.get('.editor-fields > .ui-text-muted').text()).toBe('待组合文件');
  });
});

describe('JSON navigation ownership and lifetime', () => {
  function hullTarget() {
    const target = jsonEntityFixture('skin').target;
    return {
      target: {
        ...target,
        kind: 'ship' as const,
        id: 'hull',
        linkedRecord: { kind: 'csv' as const, table: 'ships' as const, rowKey: 'ship-row' },
      },
      baseVersions: [],
    };
  }
  it.each(['save', 'input', 'query'] as const)('ends a %s wait when its original view leaves or is replaced', async (stage) => {
    await mountPage('skins');
    const document = wrapper!.getComponent(JsonDocumentEditor).props('document');
    let finish!: () => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = () => resolve(true);
    });
    onTestFinished(() => finish());
    if (stage === 'save') vi.spyOn(useSaveCommandStore(), 'waitForSaves').mockReturnValueOnce(pending);
    else if (stage === 'input') vi.spyOn(document.inputs, 'commit').mockReturnValueOnce(pending);
    else
      mocks.hullTarget.mockImplementationOnce(async () => {
        await pending;
        return hullTarget();
      });
    const button = wrapper!.findAll('.editor-actions button').find((button) => button.text() === '跳转到船体')!;
    await button.trigger('click');
    useWorkspaceStore().showAbout();
    await flushPromises();
    finish();
    await flushPromises();
    expect(useWorkspaceStore().currentView).toBe('about');
    expect(useWorkspaceStore().entityLocation).toBeNull();
    expect(mocks.hullTarget).toHaveBeenCalledTimes(stage === 'query' ? 1 : 0);
    expect(document.active.value).toBe(false);
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });
  it.each(['return', 'intent', 'document', 'failure'] as const)('rejects an earlier hull query after %s', async (boundary) => {
    await mountPage('skins');
    const own = wrapper!.getComponent(JsonDocumentEditor).props('document');
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    onTestFinished(() => finish());
    mocks.hullTarget.mockImplementationOnce(async () => {
      await pending;
      if (boundary === 'failure') throw new Error('fixture late hull');
      return hullTarget();
    });
    await wrapper!
      .findAll('.editor-actions button')
      .find((button) => button.text() === '跳转到船体')!
      .trigger('click');
    if (boundary === 'intent') useSaveCommandStore().beginTransition();
    else if (boundary === 'document') wrapper!.getComponent(JsonDocumentList).vm.$emit('select', 'b');
    else {
      useWorkspaceStore().showAbout();
      await flushPromises();
      if (boundary === 'return') useWorkspaceStore().activateModJson('M:/one', 'skins');
    }
    await flushPromises();
    finish();
    await flushPromises();
    expect(useWorkspaceStore().currentView).toBe(boundary === 'failure' ? 'about' : 'json-editor');
    expect(useWorkspaceStore().entityLocation).toBeNull();
    expect(mocks.feedback.error).not.toHaveBeenCalled();
    if (boundary === 'return') expect(useJsonEditorStore().active!.target.value?.id).toBe(own.target.value?.id);
  });
  it('acknowledges only the latest location request after a selection wait', async () => {
    await mountPage('variants');
    let finish!: (value: boolean) => void;
    vi.spyOn(useSaveCommandStore(), 'waitForSaves').mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    const workspace = useWorkspaceStore();
    workspace.entityLocation = { sessionId: 's1', modRoot: 'M:/one', kind: 'variant', id: 'b' };
    await flushPromises();
    workspace.entityLocation = { sessionId: 's1', modRoot: 'M:/one', kind: 'variant', id: 'a' };
    await flushPromises();
    finish(true);
    await flushPromises();
    expect(useJsonEditorStore().active!.target.value?.id).toBe('a');
    expect(workspace.entityLocation).toBeNull();
  });
});
