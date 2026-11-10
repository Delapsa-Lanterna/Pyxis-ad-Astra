import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as csvTable from '@/services/csv-table.service';
import * as configEntity from '@/services/json-entity.service';
import * as jsonFileService from '@/services/json-file.service';
import * as editor from '@/services/spec-editor.service';
import * as fileHistory from '@/services/file-history.service';
import * as textEditorService from '@/services/text-editor.service';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import { jsonWriteFixture } from '@/test/fixtures/json-file';
import { prepareValue } from '@/domain/schema/game-number';
import { appLogQueue } from '@/shared/runtime/app-log-queue';
import type { AppLogEntry, IndexedConfigDelete, JsonFileDelete, IndexedConfigSave, JsonFileSave, SaveEdit } from '@/shared/types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const sessionId = 's1',
  modRoot = 'M:/mod',
  id = 'demo',
  path = 'M:/mod/demo.ship';
const target = entityTargetFixture('ship', id);
const data = { hullId: id, _business: { key: '0012' } };
const jsonWrite = { preserveStructure: true };
const indexed: IndexedConfigSave = {
  sessionId,
  modRoot,
  baseVersions: [],
  kind: 'mission',
  previousId: null,
  nextId: id,
  indexRow: { mission: id },
  document: jsonWriteFixture({ title: 'Demo' }),
  text: '',
  jsonWrite,
};
const deleteIndexed: IndexedConfigDelete = { sessionId, modRoot, baseVersions: [], kind: 'mission', id, deleteTarget: true };
const definition: JsonFileSave = {
  sessionId,
  modRoot,
  baseVersions: [],
  previousId: null,
  nextId: id,
  relPath: null,
  document: jsonWriteFixture(data),
  jsonWrite,
};
const deleteJsonEntity: JsonFileDelete = {
  sessionId,
  modRoot,
  baseVersions: [],
  relPath: 'data/variants/demo.variant',
  entityId: id,
};
const readCommands = new Set([
  'load_text_file',
  'load_imported_editor_spec_file',
  'follow_text_identity',
  'query_file_history',
  'clear_file_history',
]);
const edits: Record<string, SaveEdit[]> = {
  save_editor_spec: [{ kind: 'replace', path: [], value: prepareValue(data) }],
  save_mod_info: [{ kind: 'replace', path: [], value: prepareValue(data) }],
  save_indexed_config_entity: [{ kind: 'replace', path: [], value: prepareValue({ title: 'Demo' }) }],
  save_variant_entity: [{ kind: 'replace', path: [], value: prepareValue(data) }],
  save_skin_entity: [{ kind: 'replace', path: [], value: prepareValue(data) }],
};
const cases: Array<[string, () => Promise<unknown>, object]> = [
  ['load_text_file', () => textEditorService.loadTextFile(null, modRoot, path), { sessionId: null, modRoot, path }],
  ['load_imported_editor_spec_file', () => editor.loadSpecEditorImport('ship', path), { kind: 'ship', path }],
  ['follow_text_identity', () => textEditorService.followTextIdentity('ship', '{}', id), { kind: 'ship', text: '{}', nextId: id }],
  [
    'save_csv_patch',
    () => csvTable.saveCsvPatch(sessionId, modRoot, 'ships', [], [], jsonWrite),
    { rowOrder: null, sessionId, modRoot, table: 'ships', patches: [], associatedSpecs: [], jsonWrite, baseVersions: [] },
  ],
  [
    'save_text_file',
    () => textEditorService.saveTextFile(null, modRoot, path, '0012', []),
    { sessionId: null, modRoot, path, text: '0012', baseVersions: [] },
  ],
  [
    'transcode_file_to_utf8',
    () => textEditorService.transcodeFileToUtf8(null, modRoot, path, 'gb18030'),
    { sessionId: null, modRoot, path, encoding: 'gb18030', baseVersions: [] },
  ],
  [
    'save_editor_spec',
    () =>
      editor.saveSpecEditorSpec(
        { sessionId, modRoot, target, document: jsonWriteFixture(data), jsonWrite, baseVersions: [] },
        edits.save_editor_spec!,
      ),
    { sessionId, modRoot, target, document: jsonWriteFixture(data), jsonWrite, baseVersions: [] },
  ],
  [
    'save_mod_info',
    () =>
      configEntity.saveModInfo({ sessionId, modRoot, document: jsonWriteFixture(data), jsonWrite, baseVersions: [] }, edits.save_mod_info!),
    { sessionId, modRoot, document: jsonWriteFixture(data), jsonWrite, baseVersions: [] },
  ],
  [
    'apply_file_change_set',
    () => fileHistory.replayFileChangeSet(sessionId, modRoot, 'undo', 1, 2),
    { sessionId, modRoot, direction: 'undo', entryId: 1, revision: 2 },
  ],
  ['query_file_history', () => fileHistory.loadFileHistory(sessionId, modRoot), { sessionId, modRoot }],
  ['clear_file_history', () => fileHistory.clearSavedFileHistory(sessionId, modRoot), { sessionId, modRoot }],
  ['save_indexed_config_entity', () => configEntity.saveIndexedConfigEntity(indexed, edits.save_indexed_config_entity!), indexed],
  ['create_indexed_config_entity', () => configEntity.createIndexedConfigEntity(indexed), indexed],
  ['delete_indexed_config_entity', () => configEntity.deleteIndexedConfigEntity(deleteIndexed), deleteIndexed],
  ['save_variant_entity', () => jsonFileService.saveVariantEntity(definition, edits.save_variant_entity!), definition],
  ['create_variant_entity', () => jsonFileService.createVariantEntity(definition), definition],
  ['delete_variant_entity', () => jsonFileService.deleteVariantEntity(deleteJsonEntity), deleteJsonEntity],
  ['save_skin_entity', () => jsonFileService.saveSkinEntity(definition, edits.save_skin_entity!), definition],
  ['create_skin_entity', () => jsonFileService.createSkinEntity(definition), definition],
  ['delete_skin_entity', () => jsonFileService.deleteSkinEntity(deleteJsonEntity), deleteJsonEntity],
];
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ ready: true });
});
describe('query and persistence transport protocols', () => {
  it.each(['delete', 'upsert'] as const)('records both %s row identities under the actual save request', async (action) => {
    const records: AppLogEntry[] = [];
    appLogQueue.install(async (batch) => {
      records.push(...batch);
    }, vi.fn());
    const originalRows = Object.fromEntries(['one', 'two'].map((id) => [id, { rowKey: id, data: { id }, isComment: false }]));
    const patches = Object.values(originalRows).map((row) => ({
      rowKey: row.rowKey,
      action,
      row: { id: 'next_' + row.data.id },
      isComment: false,
      columns: ['id'],
      commentChanged: false,
    }));
    await csvTable.saveCsvPatch(sessionId, modRoot, 'ships', patches, [], undefined, [], null, originalRows, { id: 'save-audit' });
    await appLogQueue.flush();
    const rows = records.filter((entry) => entry.code === 'tables.row_submitted');
    expect(rows.map((entry) => entry.fields?.previousId)).toEqual(['one', 'two']);
    expect(rows.map((entry) => entry.fields?.nextId)).toEqual(action === 'delete' ? ['', ''] : ['next_one', 'next_two']);
    expect(rows.every((entry) => entry.fields?.requestId === 'save-audit' && entry.fields.members === '2')).toBe(true);
    expect(records.find((entry) => entry.code === 'save.committed')!.fields?.requestId).toBe('save-audit');
  });
  it.each(cases)('%s preserves its wire protocol', async (command, action, payload) => {
    const result = await action();
    if (readCommands.has(command)) {
      expect(result).toEqual({ ready: true });
      expect(invoke).toHaveBeenCalledExactlyOnceWith(command, { payload });
    } else {
      expect(result).toEqual({ ready: true, requestId: expect.any(String) });
      expect(invoke).toHaveBeenCalledExactlyOnceWith('save_project', {
        request: { id: expect.any(String), edits: edits[command] ?? [], action: { kind: command, input: payload } },
      });
    }
  });
  it.each([
    [
      'save_editor_spec',
      () =>
        editor.saveSpecEditorSpec(
          { baseVersions: [], sessionId, modRoot, target, document: jsonWriteFixture(data), jsonWrite: {} },
          edits.save_editor_spec!,
        ),
      { baseVersions: [], sessionId, modRoot, target, document: jsonWriteFixture(data), jsonWrite: {} },
    ],
    ['save_indexed_config_entity', () => configEntity.saveIndexedConfigEntity(indexed, edits.save_indexed_config_entity!), indexed],
    ['save_variant_entity', () => jsonFileService.saveVariantEntity(definition, edits.save_variant_entity!), definition],
    ['save_skin_entity', () => jsonFileService.saveSkinEntity(definition, edits.save_skin_entity!), definition],
    [
      'save_csv_patch',
      () => csvTable.saveCsvPatch(sessionId, modRoot, 'ships', [], []),
      { rowOrder: null, baseVersions: [], sessionId, modRoot, table: 'ships', patches: [], associatedSpecs: [] },
    ],
  ] as const)('%s preserves supplied output options', async (command, action, payload) => {
    await action();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('save_project', {
      request: { id: expect.any(String), edits: edits[command] ?? [], action: { kind: command, input: payload } },
    });
  });

  it('orders faction JSON from its file while preserving the complete entity input', async () => {
    const value = { id, name: 'Faction' };
    const faction: IndexedConfigSave = { ...indexed, kind: 'faction', document: jsonWriteFixture(value) };
    const changes: SaveEdit[] = [{ kind: 'replace', path: [], value: prepareValue(value) }];
    await configEntity.saveIndexedConfigEntity(faction, changes);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('save_project', {
      request: {
        id: expect.any(String),
        edits: changes,
        action: {
          kind: 'save_indexed_config_entity',
          input: faction,
        },
      },
    });
  });

  it.each([null, sessionId])('text commands preserve session %s and loaded versions', async (session) => {
    const baseVersions = [{ path, fingerprint: 'loaded' }];
    await textEditorService.saveTextFile(session, modRoot, path, '{}', baseVersions);
    expect(invoke).toHaveBeenLastCalledWith('save_project', {
      request: {
        id: expect.any(String),
        edits: [],
        action: { kind: 'save_text_file', input: { baseVersions, sessionId: session, modRoot, path, text: '{}' } },
      },
    });
    await textEditorService.transcodeFileToUtf8(session, modRoot, path, 'windows-1252', baseVersions);
    expect(invoke).toHaveBeenLastCalledWith('save_project', {
      request: {
        id: expect.any(String),
        edits: [],
        action: {
          kind: 'transcode_file_to_utf8',
          input: { baseVersions, sessionId: session, modRoot, path, encoding: 'windows-1252' },
        },
      },
    });
    await textEditorService.loadTextFile(session, modRoot, path);
    expect(invoke).toHaveBeenLastCalledWith('load_text_file', { payload: { sessionId: session, modRoot, path } });
  });
});
