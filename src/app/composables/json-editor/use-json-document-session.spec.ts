import { projectChangeFixture, savedContentWorks } from '@/test/unit/project-changes';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { h, ref } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import SchemaFieldRenderer from '@/app/components/schema/SchemaFieldRenderer.vue';
import { editorUiStubs, nSelect } from '@/test/unit/ui-stubs';
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { provideAppFeedback } from '@/app/composables/use-app-feedback';
import { useJsonDocumentSession } from './use-json-document-session';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useProjectStore } from '@/stores/project.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { jsonEntityFixture } from '@/test/fixtures/json-editor';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/fixtures/write-result';
import {
  JSON_DOCUMENT_DEFINITIONS,
  jsonDocumentRecord,
  jsonDocumentId,
  jsonDocumentContent,
  type JsonDocumentDefinition,
  type JsonDocumentRecord,
} from '@/domain/json-editor/json-document-definitions';

import { getSchema } from '@/domain/schema/config-schema-registry';
import { deepClone } from '@/shared/lib/starsector';
import type {
  WindowFeedback,
  EntityData,
  RowData,
  JsonRecoveryRequest,
  JsonRecoveryPlan,
  WriteResult,
  IndexedConfigSave,
  SourceOptionGroup,
} from '@/shared/types';
import type { CommittedWriteEvent } from '@/windows/window.events';
vi.mock('@/services/window.service', () => ({ releaseNativeWindowTargets: vi.fn(async () => {}) }));
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  saveFile: vi.fn(),
  saveIndexed: vi.fn(),
  saveMod: vi.fn(),
  prepare: vi.fn(),
  recreate: vi.fn(),
  complete: vi.fn(),
  readMisc: vi.fn(),
  saveMisc: vi.fn(),
  listeners: new Set<(event: CommittedWriteEvent) => Promise<void>>(),
}));
vi.mock('@/services/entity-query.service', async (original) => ({
  ...(await original<typeof import('@/services/entity-query.service')>()),
  querySessionEntity: mocks.read,
}));
vi.mock('@/app/composables/use-core-schema', () => ({ useCoreSchema: () => ({ getMergedSchema: getSchema }) }));
vi.mock('@/services/json-recovery.service', () => ({ prepareJsonSourceRecovery: mocks.prepare }));
vi.mock('@/services/misc-config.service', async (original) => ({
  ...(await original<typeof import('@/services/misc-config.service')>()),
  queryMiscConfigFile: mocks.readMisc,
  saveMiscConfig: mocks.saveMisc,
}));
vi.mock('@/orchestrators/json-save.orchestrator', () => ({
  saveJsonFileAction: (_kind: string, ...args: unknown[]) => mocks.saveFile(...args),
  saveIndexedEntityAction: mocks.saveIndexed,
  saveModInfoAction: mocks.saveMod,
  recreateJsonSourcesAction: mocks.recreate,
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({
  ...(await import('@/test/unit/project-changes')),
  beginSavedWrite: (await import('@/test/unit/project-changes')).withSavedCompletion(() => mocks.complete()),
  listenSavedIdentity: async (handler: (event: CommittedWriteEvent) => Promise<void>) => {
    mocks.listeners.add(handler);
    return () => mocks.listeners.delete(handler);
  },
}));
let feedback: WindowFeedback;
let entities: Map<string, EntityData>;
let commit: number;
enableAutoUnmount(afterEach);
const definitions = Object.values(JSON_DOCUMENT_DEFINITIONS).filter(
  (definition): definition is JsonDocumentDefinition & { kind: Exclude<JsonDocumentDefinition['kind'], 'misc-config'> } =>
    definition.kind !== 'misc-config',
);
function record(definition: JsonDocumentDefinition, id = 'a', sessionId = 's1', modRoot = 'M:/one'): JsonDocumentRecord {
  if (definition.kind === 'misc-config')
    return {
      target: { sessionId, modRoot, kind: definition.kind, id: 'strings', entity: null },
      value: { file: {} },
      baseVersions: [{ path: modRoot + '/data/strings/strings.json', fingerprint: 'v1' }],
      resources: {},
    };
  if (definition.kind === 'mod-info')
    return {
      target: { sessionId, modRoot, kind: definition.kind, id: 'mod-info', entity: null },
      value: { file: { id: 'mod', name: 'Saved' } },
      baseVersions: [{ path: modRoot + '/mod_info.json', fingerprint: 'v1' }],
      resources: {},
    };
  const entity = jsonEntityFixture(definition.kind, id, 'Saved', modRoot);
  entities.set(sessionId + ':' + definition.kind + ':' + id, entity);
  return jsonDocumentRecord(sessionId, modRoot, entity);
}
function document(definition = JSON_DOCUMENT_DEFINITIONS.variants, id = 'a', sessionId = 's1', modRoot = 'M:/one') {
  return useJsonDocumentSession(definition, record(definition, id, sessionId, modRoot), feedback);
}
function edit(doc: ReturnType<typeof document>, definition: JsonDocumentDefinition, name: string, id?: string) {
  const value = deepClone(doc.draftValue.value);
  const data = jsonDocumentContent(definition.kind, value);
  data[
    definition.kind === 'mission'
      ? 'title'
      : definition.kind === 'skin'
        ? 'hullName'
        : definition.kind === 'mod-info'
          ? 'name'
          : 'displayName'
  ] = name;
  if (id) (definition.kind === 'mission' ? (value.list as RowData) : data)[definition.idField] = id;
  doc.draftValue.value = value;
}
function receipt(before: EntityData | null, after: EntityData | null): WriteResult {
  const result = savedWriteFixture();
  commit++;

  result.baseVersions = (after?.baseVersions ?? [{ path: 'M:/one/mod_info.json' }]).map((version) => ({
    ...version,
    fingerprint: 'v' + commit,
  }));
  if (before && after) result.identityChanges = [{ before: before.target, after: after.target }];
  return result;
}
async function prepare(request: JsonRecoveryRequest): Promise<JsonRecoveryPlan> {
  const { origin, sessionId, modRoot } = request;
  if (origin.kind === 'entity') {
    const entity = entities.get(sessionId + ':' + origin.target.kind + ':' + origin.target.id)!;
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
  const manifest = useProjectStore().getManifest(modRoot)!;
  return {
    request,
    missingPaths: [],
    baseVersions: manifest.baseVersions,
    currentSources: { file: origin.kind === 'modInfo' ? manifest.modInfo! : {} },
    resourceRefs: {},
  };
}
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ editHistoryLimit: 2 }));
  vi.clearAllMocks();
  mocks.listeners.clear();
  entities = new Map();
  commit = 1;
  for (const [session, root] of [
    ['s1', 'M:/one'],
    ['s2', 'M:/two'],
  ]) {
    const manifest = sessionUpdateFixture(session!, root!).projection.manifest;
    manifest.modInfo = { id: 'mod', name: 'Saved' };
    useProjectStore().registerProjectManifest(manifest);
  }
  feedback = {
    fileActions: vi.fn(() => []),
    choose: vi.fn(async () => 'recreate'),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    confirmWarning: vi.fn((options) => options.onConfirm()),
    confirmDanger: vi.fn(),
  };
  mocks.complete.mockResolvedValue(undefined);
  mocks.readMisc.mockResolvedValue({
    kind: 'strings',
    data: {},
    baseVersions: [{ path: 'M:/one/data/strings/strings.json', fingerprint: 'v1' }],
  });
  mocks.saveMisc.mockImplementation(async (payload) => ({
    ...receipt(null, null),
    content: { target: { kind: 'json', origin: { kind: 'modInfo' } }, value: payload.data },
    baseVersions: payload.baseVersions.map((v: { path: string }) => ({ ...v, fingerprint: 'saved' })),
  }));
  mocks.read.mockImplementation(async (session: string, kind: string, id: string) => entities.get(session + ':' + kind + ':' + id) ?? null);
  mocks.prepare.mockImplementation(prepare);
  mocks.saveFile.mockImplementation(
    async (session: string, root: string, id: string, data: RowData, previous: string | null, relPath: string) => {
      const kind = relPath.endsWith('.skin') ? 'skin' : 'variant';
      const before = entities.get(session + ':' + kind + ':' + (previous ?? id))!;
      const after = jsonEntityFixture(kind, id, '', root);
      after.data = deepClone(data);
      entities.delete(session + ':' + kind + ':' + before.id);
      entities.set(session + ':' + kind + ':' + id, after);
      const result = receipt(before, after);
      after.baseVersions = result.baseVersions;
      return { entity: { ...after, id, data, relPath: after.target.write.relPath, path: after.target.write.path }, receipt: result };
    },
  );
  mocks.saveIndexed.mockImplementation(async (write: IndexedConfigSave) => {
    const before = entities.get(write.sessionId + ':' + write.kind + ':' + write.previousId)!;
    const after = jsonEntityFixture(write.kind, write.nextId, '', write.modRoot);
    after.data = write.kind === 'faction' ? write.entityData.file! : { ...write.entityData, list: write.indexRow };
    entities.delete(write.sessionId + ':' + write.kind + ':' + before.id);
    entities.set(write.sessionId + ':' + write.kind + ':' + write.nextId, after);
    const result = receipt(before, after);
    after.baseVersions = result.baseVersions;
    return {
      entity: {
        entityId: write.nextId,
        entityData: write.entityData,
        indexRows: [{ data: write.indexRow, isComment: false }],
        baseVersions: result.baseVersions,
      },
      receipt: result,
    };
  });
  mocks.saveMod.mockImplementation(async (_session: string, root: string, data: RowData) => ({
    ...receipt(null, null),
    baseVersions: [{ path: root + '/mod_info.json', fingerprint: 'v2' }],
    content: { target: { kind: 'json', origin: { kind: 'modInfo' } }, value: data },
  }));
});
afterEach(() => {
  useJsonEditorStore().releaseSession('s1');
  useJsonEditorStore().releaseSession('s2');
});
describe('complete JSON document runtime', () => {
  it('adds a slot only after selection and transfers the weapon with one undo', async () => {
    const doc = document();
    doc.draftValue.value = { ...doc.draftValue.value, weaponGroups: [{ weapons: { A: 'gun' } }, { weapons: { B: 'other' } }] };
    const before = deepClone(doc.draftValue.value);
    const selectStub = { ...nSelect, methods: { focusInput: vi.fn() } };
    const field = getSchema('variant')!
      .sections!.flatMap((section) => section.fields)
      .find((field) => field.key === 'weaponGroups')!;
    const view = mount(
      {
        setup() {
          provideFieldInputs(doc.inputs);
          provideAppFeedback(feedback);
          return () =>
            h(SchemaFieldRenderer, {
              field,
              value: doc.draftValue.value.weaponGroups,
              runtimeContext: {
                sessionId: 's1',
                modRoot: 'M:/one',
                querySourceOptions: async (): Promise<SourceOptionGroup[]> => [
                  {
                    origin: 'mod',
                    options: ['A', 'B'].map((value) => ({ value, label: value, origin: 'mod', resourceRef: null, description: null })),
                  },
                ],
              },
              onUpdate: (update) => {
                if (update.kind === 'set') doc.draftValue.value = { ...doc.draftValue.value, weaponGroups: update.value as RowData[] };
              },
            });
        },
      },
      { global: { stubs: { ...editorUiStubs, 'n-select': selectStub } } },
    );
    await flushPromises();
    const destination = view.get('[data-field-path=\'weaponGroups[1]["weapons"]\']');
    await destination.findAll('button').at(-1)!.trigger('click');
    expect(doc.draftValue.value).toEqual(before);
    await destination.findAll('select').at(-1)!.trigger('keydown', { key: 'Escape' });
    expect(doc.draftValue.value).toEqual(before);
    await destination.findAll('button').at(-1)!.trigger('click');
    const picker = destination.findAllComponents(selectStub).at(-1)!;
    picker.vm.$emit('update:show', false);
    picker.vm.$emit('update:value', 'A');
    await flushPromises();
    expect(doc.draftValue.value.weaponGroups).toEqual([{ weapons: {} }, { weapons: { B: 'other', A: 'gun' } }]);
    expect(await doc.undo()).toBe(true);
    expect(doc.draftValue.value).toEqual(before);
  });
  it('accepts a freshly read file without another request and refreshes once on return', async () => {
    const doc = document(JSON_DOCUMENT_DEFINITIONS['misc-config']);
    doc.setActive(true, true);
    await flushPromises();
    expect(mocks.readMisc).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    doc.setActive(false);
    doc.setActive(true);
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.readMisc).not.toHaveBeenCalled();
  });
  it('rejects a late refresh after page departure and accepts the next lifetime', async () => {
    const doc = document();
    let complete!: (plan: JsonRecoveryPlan) => void;
    mocks.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    doc.setActive(true);
    doc.setActive(false);
    const request: JsonRecoveryRequest = { sessionId: 's1', modRoot: 'M:/one', origin: { kind: 'modInfo' } };
    complete({ request, baseVersions: [], missingPaths: ['late'], currentSources: {}, resourceRefs: {} });
    await flushPromises();
    expect(doc.sourceMissing.value).toBe(false);
    expect(doc.draftValue.value.displayName).toBe('Saved');
    doc.setActive(true);
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(feedback.error).not.toHaveBeenCalled();
  });
  it('revokes an earlier source snapshot when a local edit commits', async () => {
    const doc = document();
    let complete!: (plan: JsonRecoveryPlan) => void;
    mocks.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    doc.setActive(true);
    const request = mocks.prepare.mock.lastCall![0] as JsonRecoveryRequest;
    const snapshot = await prepare(request);
    edit(doc, JSON_DOCUMENT_DEFINITIONS.variants, 'Local');
    complete({ ...snapshot, baseVersions: snapshot.baseVersions.map((version) => ({ ...version, fingerprint: 'late' })) });
    await flushPromises();
    expect(doc.draftValue.value.displayName).toBe('Local');
    expect(doc.externalUpdateNotice.value).toBe('');
    expect(doc.record.value.baseVersions[0]!.fingerprint).toBe('v1');
  });
  it('retains numeric strings, draft history and newer edits across a misc config save', async () => {
    const doc = document(JSON_DOCUMENT_DEFINITIONS['misc-config']);
    expect(doc.schema.value.id).toBe('strings');
    doc.draftValue.value = { file: { 'group.一': { line: '001' } } };
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const original = mocks.saveMisc.getMockImplementation()!;
    mocks.saveMisc.mockImplementationOnce(async (payload) => {
      await gate;
      return original(payload);
    });
    const saving = doc.save();
    await flushPromises();
    doc.draftValue.value = { file: { 'group.一': { line: ' 123\n$token ' } } };
    finish();
    expect((await saving).status).toBe('saved');
    expect(mocks.saveMisc.mock.lastCall![0]).toMatchObject({ kind: 'strings', data: { 'group.一': { line: '001' } } });
    expect(doc.dirty.value).toBe(true);
    expect(doc.draftValue.value.file).toEqual({ 'group.一': { line: ' 123\n$token ' } });
    expect(await doc.undo()).toBe(true);
    expect(doc.dirty.value).toBe(false);
    expect(await doc.redo()).toBe(true);
    expect(doc.dirty.value).toBe(true);
    expect(document(JSON_DOCUMENT_DEFINITIONS['misc-config'])).toBe(doc);
    useJsonEditorStore().releaseSession('s1');
    expect(useSaveCommandStore().editTargets).toHaveLength(0);
  });
  it('retains misc config edits on write failure and reports a missing source through recovery', async () => {
    const doc = document(JSON_DOCUMENT_DEFINITIONS['misc-config']);
    doc.draftValue.value = { file: { dialogue: { line: 'local' } } };
    mocks.saveMisc.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(doc.save()).rejects.toThrow();
    expect(doc.dirty.value).toBe(true);
    mocks.prepare.mockImplementation(async (request) => ({
      request,
      baseVersions: [],
      missingPaths: ['data/strings/strings.json'],
      currentSources: {},
      resourceRefs: {},
    }));
    doc.setActive(true);
    await flushPromises();
    expect(mocks.prepare.mock.lastCall![0].origin).toEqual({ kind: 'miscConfig', file: 'strings' });
    expect(doc.sourceMissing.value).toBe(true);
    expect(doc.draftValue.value.file).toEqual({ dialogue: { line: 'local' } });
    expect(await doc.undo()).toBe(true);
  });
  it.each(definitions)(
    '$kind retains its formal target and saves its complete content and credentials through one participant',
    async (definition) => {
      const doc = document(definition);
      edit(doc, definition, 'Submitted');
      const initial = deepClone(doc.record.value!);
      const handles = useSaveCommandStore().participantsForTargets(
        initial.baseVersions.map((version) => ({ sessionId: 's1', modRoot: 'M:/one', path: version.path })),
      );
      expect(handles).toHaveLength(1);
      expect(doc.target.value).toEqual(initial.target);
      const result = await useSaveCommandStore().requestSave(handles[0]!);
      expect(result.status).toBe('saved');
      expect(doc.dirty.value).toBe(false);
      expect(doc.record.value!.baseVersions.every((version) => version.fingerprint !== 'v1')).toBe(true);
      const call = definition.file
        ? mocks.saveFile.mock.lastCall!
        : definition.kind === 'mod-info'
          ? mocks.saveMod.mock.lastCall!
          : mocks.saveIndexed.mock.lastCall!;
      if (definition.file)
        expect(call.slice(0, 4)).toEqual([
          's1',
          'M:/one',
          'a',
          initial.target.kind === 'variant'
            ? { variantId: 'a', hullId: 'hull', displayName: 'Submitted' }
            : { skinHullId: 'a', baseHullId: 'hull', hullName: 'Submitted' },
        ]);
      else if (definition.kind === 'mod-info') expect(call[2]).toMatchObject({ name: 'Submitted' });
      else
        expect(call[0]).toMatchObject({
          previousId: 'a',
          baseVersions: initial.baseVersions,
          entityData:
            definition.kind === 'faction'
              ? { file: { id: 'a', displayName: 'Submitted' } }
              : { descriptor: { title: 'Submitted' }, text: 'Body' },
          indexRow: definition.kind === 'mission' ? { mission: 'a' } : { faction: 'data/world/factions/a.faction' },
        });
      expect(await doc.undo()).toBe(true);
      expect(doc.dirty.value).toBe(true);
      expect(await doc.redo()).toBe(true);
      expect(doc.dirty.value).toBe(false);
      expect(feedback.success).toHaveBeenCalledOnce();
    },
  );
  it.each(definitions)('$kind isolates document lifetime, input, baseline and bounded history by session', async (definition) => {
    const a = document(definition);
    edit(a, definition, 'One');
    edit(a, definition, 'Two');
    edit(a, definition, 'Three');
    a.setActive(false);
    const same = document(definition);
    expect(same).toBe(a);
    const other = document(definition, 'a', 's2', 'M:/two');
    expect(other.draftValue.value).toEqual(other.record.value!.value);
    expect(await a.undo()).toBe(true);
    expect(await a.undo()).toBe(true);
    expect(await a.undo()).toBeNull();
    useJsonEditorStore().releaseSession('s1');
    expect(useSaveCommandStore().editTargets.filter((target) => target.sessionId === 's1')).toEqual([]);
    expect(other.target.value!.sessionId).toBe('s2');
    expect(mocks.listeners.size).toBe(definition.kind === 'mod-info' ? 0 : 1);
  });
  it.each(definitions)('$kind retains newer edits and undo while accepting the actual written baseline', async (definition) => {
    const doc = document(definition);
    edit(doc, definition, 'Submitted');
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const writer = definition.file ? mocks.saveFile : definition.kind === 'mod-info' ? mocks.saveMod : mocks.saveIndexed;
    const original = writer.getMockImplementation()!;
    writer.mockImplementationOnce(async (...args: unknown[]) => {
      await gate;
      return original(...args);
    });
    const saving = doc.save();
    const repeated = doc.save();
    await flushPromises();
    edit(doc, definition, 'Later');
    await doc.undo();
    await doc.undo();
    finish();
    expect(await repeated).toEqual(await saving);
    expect(doc.dirty.value).toBe(true);
    expect(doc.record.value!.value).not.toEqual(doc.draftValue.value);
    expect(await doc.redo()).toBe(true);
    expect(doc.dirty.value).toBe(false);
    expect(writer).toHaveBeenCalledOnce();
  });
  it('rejects raw input without consuming history or queueing a disk write', async () => {
    const doc = document();
    edit(doc, JSON_DOCUMENT_DEFINITIONS.variants, 'Draft');
    const dirty = ref(true),
      focus = vi.fn();
    doc.inputs.register({ key: 'name', label: 'Name', dirty, focus, cancel: vi.fn(), commit: () => 'Invalid' });
    await expect(doc.save()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    await expect(doc.undo()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(focus).toHaveBeenCalledTimes(2);
    expect(mocks.saveFile).not.toHaveBeenCalled();
    dirty.value = false;
    expect(await doc.undo()).toBe(true);
  });
  it.each(
    definitions
      .filter((definition) => definition.kind !== 'mod-info')
      .flatMap((definition) => [false, true].map((dirty) => ({ definition, dirty }))),
  )('$definition.kind accepts background rename with dirty=$dirty and preserves mapped history', async ({ definition, dirty }) => {
    const doc = document(definition);
    doc.setActive(false);
    if (dirty) edit(doc, definition, 'Local');
    const before = entities.get('s1:' + definition.kind + ':a')!,
      after = jsonEntityFixture(definition.kind as 'faction' | 'mission' | 'variant' | 'skin', 'next', 'External');
    entities.set('s1:' + definition.kind + ':next', after);
    const result = receipt(before, after);
    await Promise.all(
      [...mocks.listeners].map((listener) =>
        listener({ originWindowLabel: 'peer', reason: 'save', sessionId: 's1', modRoot: 'M:/one', result }),
      ),
    );
    if (dirty) {
      expect(doc.target.value!.id).toBe('next');
      vi.mocked(feedback.choose).mockResolvedValueOnce('follow');
      doc.setActive(true);
      await flushPromises();

      expect(doc.dirty.value).toBe(true);
      await doc.undo();
      expect(jsonDocumentId(definition, doc.draftValue.value)).toBe('next');
    }
    expect(doc.target.value!.entity).toEqual(after.target);
    expect(doc.target.value!.id).toBe('next');
  });
  it('retries synchronization through the saved receipt with one identity acceptance and no repeated write', async () => {
    const doc = document();
    edit(doc, JSON_DOCUMENT_DEFINITIONS.variants, 'Draft', 'next');
    mocks.complete.mockRejectedValueOnce(new Error('broadcast'));
    await doc.save();
    await expect(savedContentWorks.at(-1)!.content).rejects.toThrow('broadcast');
    const target = doc.target.value;
    edit(doc, JSON_DOCUMENT_DEFINITIONS.variants, 'Later');
    expect(useSaveCommandStore().waitForSaves()).toBeUndefined();
    await savedContentWorks.at(-1)!.retryContent();
    expect(doc.target.value).toBe(target);
    expect(mocks.saveFile).toHaveBeenCalledOnce();
    expect(doc.dirty.value).toBe(true);
    expect(feedback.success).toHaveBeenCalledOnce();
  });
  it.each(definitions)('$kind recreates the original baseline and path while retaining draft identity and history', async (definition) => {
    const doc = document(definition);
    const baseline = deepClone(doc.record.value!);
    edit(doc, definition, 'Local', 'unsaved');
    const origin =
      definition.kind === 'mod-info'
        ? { kind: 'modInfo' as const }
        : {
            kind: 'entity' as const,
            target: { sessionId: 's1', modRoot: 'M:/one', kind: definition.kind, id: 'a', relPath: baseline.target.entity!.write.relPath },
          };
    const plan: JsonRecoveryPlan = {
      request: { sessionId: 's1', modRoot: 'M:/one', origin },
      baseVersions: baseline.baseVersions.map((version) => ({ ...version, fingerprint: null })),
      missingPaths: baseline.baseVersions.map((version) => version.path.slice('M:/one/'.length)),
      currentSources: {},
      resourceRefs: {},
    };
    mocks.prepare.mockResolvedValue(plan);
    const result: WriteResult<JsonRecoveryPlan> = {
      ...receipt(null, null),
      baseVersions: baseline.baseVersions.map((version) => ({ ...version, fingerprint: 'restored' })),
      content: {
        target: { kind: 'json', origin: { kind: 'modInfo' } },
        value: {
          ...plan,
          missingPaths: [],
          currentSources: definition.file
            ? { file: baseline.value }
            : definition.kind === 'mission'
              ? {
                  descriptor: baseline.value.descriptor!,
                  text: 'Body',
                  index: { rows: [{ isComment: false, data: baseline.value.list! }] },
                }
              : { file: baseline.value.file! },
        },
      },
    };
    mocks.recreate.mockResolvedValue(result);
    expect(await doc.recreateSources()).toBe(true);
    expect(mocks.recreate.mock.lastCall!.slice(0, 2)).toEqual([plan, baseline.value]);
    expect(doc.target.value).toEqual(baseline.target);
    expect(doc.dirty.value).toBe(true);
    expect(doc.record.value!.value).toEqual(baseline.value);
    expect(doc.sourceMissing.value).toBe(false);
    expect(await doc.undo()).toBe(true);
  });
  it.each(definitions)(
    '$kind records missing sources while preserving draft and history until explicit external acceptance',
    async (definition) => {
      const doc = document(definition),
        baseline = deepClone(doc.record.value);
      edit(doc, definition, 'Local');
      mocks.prepare.mockResolvedValue({
        request: {},
        baseVersions: baseline.baseVersions,
        missingPaths: ['missing.json'],
        currentSources: {},
        resourceRefs: {},
      });
      doc.setActive(true);
      await flushPromises();
      expect(doc.sourceMissing.value).toBe(true);
      expect(doc.dirty.value).toBe(true);
      mocks.prepare.mockImplementation(prepare);
      if (definition.kind === 'mod-info') {
        const manifest = useProjectStore().getManifest('M:/one')!;
        manifest.modInfo = { id: 'mod', name: 'External' };
        manifest.baseVersions = [{ path: 'M:/one/mod_info.json', fingerprint: 'external' }];
      } else {
        const entity = jsonEntityFixture(definition.kind, 'a', 'External');
        entity.baseVersions = entity.baseVersions.map((v) => ({ ...v, fingerprint: 'external' }));
        entities.set('s1:' + definition.kind + ':a', entity);
      }
      void projectChangeFixture('s1', {
        ...savedWriteFixture().invalidation,
        queryScopes: [
          {
            kind: 'entity-detail',
            entity: { kind: definition.kind === 'mod-info' ? 'variant' : definition.kind, id: 'a' },
            table: null,
            source: null,
            resource: null,
          },
        ],
      });
      await flushPromises();
      expect(doc.sourceMissing.value).toBe(false);
      expect(doc.externalUpdateNotice.value).toContain('外部');
      expect(doc.record.value).toEqual(baseline);
      await doc.loadPendingExternal();
      expect(doc.dirty.value).toBe(false);
      expect(doc.record.value.baseVersions.every((v) => v.fingerprint === 'external')).toBe(true);
      expect(await doc.undo()).toBeNull();
    },
  );
  it.each(['cancel', 'conflict', 'reappeared', 'synchronization'] as const)(
    'finishes source recovery correctly after %s',
    async (outcome) => {
      const doc = document(),
        baseline = deepClone(doc.record.value);
      edit(doc, JSON_DOCUMENT_DEFINITIONS.variants, 'Local', 'unsaved');
      const plan = {
        request: {
          sessionId: 's1',
          modRoot: 'M:/one',
          origin: {
            kind: 'entity' as const,
            target: {
              sessionId: 's1',
              modRoot: 'M:/one',
              kind: 'variant' as const,
              id: 'a',
              relPath: baseline.target.entity!.write.relPath,
            },
          },
        },
        baseVersions: baseline.baseVersions.map((version) => ({ ...version, fingerprint: null })),
        missingPaths: [baseline.target.entity!.write.relPath],
        currentSources: {},
        resourceRefs: {},
      };
      mocks.prepare.mockResolvedValue({ ...plan, missingPaths: outcome === 'reappeared' ? [] : plan.missingPaths });
      if (outcome === 'cancel') vi.mocked(feedback.choose).mockResolvedValueOnce(null);
      if (outcome === 'conflict') mocks.recreate.mockRejectedValueOnce(new Error('version conflict'));
      if (outcome === 'synchronization') {
        mocks.recreate.mockResolvedValueOnce({
          ...receipt(null, null),
          baseVersions: baseline.baseVersions,
          content: {
            target: { kind: 'json', origin: { kind: 'modInfo' } },
            value: { ...plan, missingPaths: [], currentSources: { file: baseline.value } },
          },
        });
        mocks.complete.mockRejectedValueOnce(new Error('broadcast'));
      }
      expect(await doc.recreateSources()).toBe(outcome === 'synchronization');
      if (outcome === 'synchronization') {
        await expect(savedContentWorks.at(-1)!.content).rejects.toThrow('broadcast');
        expect(await doc.waitForSave()).toBe(true);
        await savedContentWorks.at(-1)!.retryContent();
      }
      expect(doc.target.value).toEqual(baseline.target);
      expect(doc.dirty.value).toBe(true);
      expect(jsonDocumentId(JSON_DOCUMENT_DEFINITIONS.variants, doc.draftValue.value)).toBe('unsaved');
      expect(mocks.recreate).toHaveBeenCalledTimes(outcome === 'conflict' || outcome === 'synchronization' ? 1 : 0);
      expect(feedback.success).toHaveBeenCalledTimes(outcome === 'synchronization' ? 1 : 0);
    },
  );
  it('preserves independently captured contents and later raw inputs', async () => {
    const a = document(),
      b = document(JSON_DOCUMENT_DEFINITIONS.variants, 'b');
    edit(a, JSON_DOCUMENT_DEFINITIONS.variants, 'A');
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const original = mocks.saveFile.getMockImplementation()!;
    mocks.saveFile.mockImplementationOnce(async (...args: unknown[]) => {
      await gate;
      return original(...args);
    });
    const savingA = a.save(),
      savingB = b.save();
    const external = entities.get('s1:variant:b')!;
    external.baseVersions = external.baseVersions.map((v) => ({ ...v, fingerprint: 'latest' }));
    b.setActive(true);
    await flushPromises();
    const raw = ref(true);
    b.inputs.register({
      key: 'name',
      label: 'Name',
      dirty: raw,
      focus: vi.fn(),
      cancel: vi.fn(),
      commit: () => {
        edit(b, JSON_DOCUMENT_DEFINITIONS.variants, 'Queued latest');
        raw.value = false;
        return null;
      },
    });

    finish();
    await savingA;
    await savingB;
    expect(mocks.saveFile.mock.calls.find((call) => call[2] === 'b')).toBeUndefined();
    expect(raw.value).toBe(true);
    expect(a.dirty.value).toBe(false);
    expect(b.dirty.value).toBe(true);
  });
});
