import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as csvTable from '@/services/csv-table.service';
import * as configEntity from '@/services/json-entity.service';
import * as jsonFileService from '@/services/json-file.service';
import * as editor from '@/services/spec-editor.service';
import * as fileHistory from '@/services/file-history.service';
import * as fileService from '@/services/files.service';
import { entityTargetFixture } from '@/test/entity-target';
import type {
  DeleteIndexedConfigEntityPayload,
  DeleteJsonEntityFilePayload,
  IndexedConfigEntityPayload,
  JsonEntityFilePayload,
} from '@/shared/types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const sessionId = 's1',
  modRoot = 'M:/mod',
  id = 'demo',
  path = 'M:/mod/demo.ship';
const target = entityTargetFixture('ship', id);
const data = { hullId: id, _business: { key: '0012' } };
const jsonWrite = { preserveOriginalJson: true, confirmedSources: [] };
const indexed: IndexedConfigEntityPayload = {
  sessionId,
  modRoot,
  baseVersions: [],
  kind: 'mission',
  previousId: null,
  nextId: id,
  indexRow: { mission: id },
  entityData: { descriptor: { title: 'Demo' }, text: '' },
};
const deleteIndexed: DeleteIndexedConfigEntityPayload = { sessionId, modRoot, baseVersions: [], kind: 'mission', id, deleteTarget: true };
const definition: JsonEntityFilePayload = {
  sessionId,
  modRoot,
  baseVersions: [],
  previousId: null,
  nextId: id,
  relPath: null,
  data,
};
const deleteJsonEntity: DeleteJsonEntityFilePayload = {
  sessionId,
  modRoot,
  baseVersions: [],
  relPath: 'data/variants/demo.variant',
  entityId: id,
};
const cases: Array<[string, () => Promise<unknown>, object]> = [
  ['load_editable_file', () => fileService.loadEditableFileData(null, modRoot, path), { sessionId: null, modRoot, path }],
  ['load_imported_editor_spec_file', () => editor.loadSpecEditorImport('ship', path), { kind: 'ship', path }],
  [
    'query_text_identity_intent',
    () => fileService.queryFileTextIdentityIntent(sessionId, target, '{}'),
    { sessionId, source: target, text: '{}' },
  ],
  ['follow_text_identity', () => fileService.followFileTextIdentity('ship', '{}', id), { kind: 'ship', text: '{}', nextId: id }],
  [
    'save_csv_patch',
    () => csvTable.saveCsvPatch(sessionId, modRoot, 'ships', [], [], jsonWrite),
    { rowOrder: null, sessionId, modRoot, table: 'ships', patches: [], associatedSpecs: [], jsonWrite, baseVersions: [] },
  ],
  [
    'save_text_file',
    () => fileService.writeEditableFileText(null, modRoot, path, '0012', []),
    { sessionId: null, modRoot, path, text: '0012', baseVersions: [] },
  ],
  [
    'transcode_file_to_utf8',
    () => fileService.transcodeFileToUtf8(null, modRoot, path, 'gb18030'),
    { sessionId: null, modRoot, path, encoding: 'gb18030', baseVersions: [] },
  ],
  [
    'save_editor_spec',
    () => editor.saveSpecEditorSpec(sessionId, modRoot, target, data, jsonWrite),
    { sessionId, modRoot, target, data, jsonWrite, orderedJson: JSON.stringify(data), baseVersions: [] },
  ],
  [
    'save_mod_info',
    () => configEntity.saveModInfo(sessionId, modRoot, data, jsonWrite),
    { sessionId, modRoot, data, jsonWrite, orderedJson: JSON.stringify(data), baseVersions: [] },
  ],
  [
    'apply_file_change_set',
    () => fileHistory.replayFileChangeSet(sessionId, modRoot, 'undo', 1, 2),
    { sessionId, modRoot, direction: 'undo', entryId: 1, revision: 2 },
  ],
  ['query_file_history', () => fileHistory.loadFileHistory(sessionId, modRoot), { sessionId, modRoot }],
  ['clear_file_history', () => fileHistory.clearSavedFileHistory(sessionId, modRoot), { sessionId, modRoot }],
  [
    'save_indexed_config_entity',
    () => configEntity.saveIndexedConfigEntity(indexed, jsonWrite),
    { ...indexed, jsonWrite, orderedJson: JSON.stringify(indexed.entityData.descriptor) },
  ],
  ['create_indexed_config_entity', () => configEntity.createIndexedConfigEntity(indexed), indexed],
  ['delete_indexed_config_entity', () => configEntity.deleteIndexedConfigEntity(deleteIndexed), deleteIndexed],
  [
    'save_variant_entity',
    () => jsonFileService.saveVariantEntity(definition, jsonWrite),
    { ...definition, jsonWrite, orderedJson: JSON.stringify(data) },
  ],
  ['create_variant_entity', () => jsonFileService.createVariantEntity(definition), definition],
  ['delete_variant_entity', () => jsonFileService.deleteVariantEntity(deleteJsonEntity), deleteJsonEntity],
  [
    'save_skin_entity',
    () => jsonFileService.saveSkinEntity(definition, jsonWrite),
    { ...definition, jsonWrite, orderedJson: JSON.stringify(data) },
  ],
  ['create_skin_entity', () => jsonFileService.createSkinEntity(definition), definition],
  ['delete_skin_entity', () => jsonFileService.deleteSkinEntity(deleteJsonEntity), deleteJsonEntity],
];
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ ready: true });
});
describe('query and persistence transport protocols', () => {
  it.each(cases)('%s preserves its wire protocol', async (command, action, payload) => {
    const result = await action();
    expect(result).toEqual({ ready: true });
    expect(invoke).toHaveBeenCalledExactlyOnceWith(command, { payload });
  });
  it.each([
    [
      'save_editor_spec',
      () => editor.saveSpecEditorSpec(sessionId, modRoot, target, data),
      { baseVersions: [], sessionId, modRoot, target, data },
    ],
    ['save_indexed_config_entity', () => configEntity.saveIndexedConfigEntity(indexed), indexed],
    ['save_variant_entity', () => jsonFileService.saveVariantEntity(definition), definition],
    ['save_skin_entity', () => jsonFileService.saveSkinEntity(definition), definition],
    [
      'save_csv_patch',
      () => csvTable.saveCsvPatch(sessionId, modRoot, 'ships', [], []),
      { rowOrder: null, baseVersions: [], sessionId, modRoot, table: 'ships', patches: [], associatedSpecs: [] },
    ],
  ] as const)('%s preserves omitted JSON options', async (command, action, payload) => {
    await action();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(command, { payload });
  });

  it('orders faction JSON from its file while preserving the complete entity input', async () => {
    const faction: IndexedConfigEntityPayload = { ...indexed, kind: 'faction', entityData: { file: { id, name: 'Faction' } } };
    await configEntity.saveIndexedConfigEntity(faction, jsonWrite);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('save_indexed_config_entity', {
      payload: { ...faction, jsonWrite, orderedJson: JSON.stringify(faction.entityData.file) },
    });
  });

  it.each([null, sessionId])('text commands preserve session %s and loaded versions', async (session) => {
    const baseVersions = [{ path, fingerprint: 'loaded' }];
    await fileService.writeEditableFileText(session, modRoot, path, '{}', baseVersions);
    expect(invoke).toHaveBeenLastCalledWith('save_text_file', { payload: { baseVersions, sessionId: session, modRoot, path, text: '{}' } });
    await fileService.transcodeFileToUtf8(session, modRoot, path, 'windows-1252', baseVersions);
    expect(invoke).toHaveBeenLastCalledWith('transcode_file_to_utf8', {
      payload: { baseVersions, sessionId: session, modRoot, path, encoding: 'windows-1252' },
    });
    await fileService.loadEditableFileData(session, modRoot, path);
    expect(invoke).toHaveBeenLastCalledWith('load_editable_file', { payload: { sessionId: session, modRoot, path } });
  });
});
