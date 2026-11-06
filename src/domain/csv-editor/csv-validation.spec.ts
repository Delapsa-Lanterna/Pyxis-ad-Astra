import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { TABLE_KEYS, type CsvTableKey } from '@/shared/types';
import { csvDraftRow, csvTableIndex } from '@/test/fixtures/csv-row';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { csvTableIssues as allTableIssues, csvValidationDefinitions } from './csv-validation';
const csvTableIssues: typeof allTableIssues = (state) => allTableIssues(state).filter((issue) => issue.code === 'csv.identity_duplicate');
import {
  applyCsvDraftEdit,
  applyCsvTableIndexDraft,
  acceptSavedCsvTableIndex,
  commitCsvTableSaveDraft,
  deleteCsvRowDraft,
  insertCsvRowsDraft,
  moveCsvRowDraft,
  replaceCsvTableDraft,
  setCsvCellValueDraft,
} from './csv-table-draft';

beforeEach(() => setActivePinia(createPinia()));
const row = (id: string, index: number, isComment = false, type = '') => csvDraftRow({ id, type }, 'row-' + index, isComment);
function document(table: CsvTableKey = 'ships') {
  const manifest = sessionUpdateFixture('validation-session', 'M:/validation').content.manifest;
  const tables = useCsvEditorStore();
  tables.initializeModTables({ ...manifest, manifest });
  return tables.getCsvModState(manifest.modRoot)!.documents[table];
}

describe('CSV table-specific validation', () => {
  it.each(TABLE_KEYS.filter((table) => !['descriptions', 'simOpponents'].includes(table)))('checks exact IDs for %s', (table) => {
    const issues = csvValidationDefinitions[table].validate([
      row('sample_wing', 0),
      row('', 1),
      row('sample_wing', 2, true),
      row('Sample_wing', 3),
      row('sample_wing', 4),
      row('', 5),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', code: 'csv.identity_duplicate' });
    expect(issues[0]!.message).toContain('2 条记录，序号：1、5');
  });
  it('uses both description keys and preserves simulator repetitions', () => {
    const rows = [row('sample', 0, false, 'SHIP'), row('sample', 1, false, 'WEAPON'), row('sample', 2, false, 'SHIP')];
    expect(csvValidationDefinitions.descriptions.validate(rows)).toMatchObject([{ path: '["sample","SHIP"]' }]);
    expect(csvValidationDefinitions.simOpponents.validate(rows)).toEqual([]);
  });
  it('checks the literal wing suffix for each nonempty business ID', () => {
    const rows = [row('sample_wing', 0), row('sample_WING', 1), row('other', 2), row('', 3), row('comment', 4, true)];
    expect(csvValidationDefinitions.wings.validate(rows)).toMatchObject([
      { severity: 'warning', path: 'row-1' },
      { severity: 'warning', path: 'row-2' },
    ]);
  });
  it('checks unloaded and search-hidden rows using their current document positions', () => {
    const state = document();
    const rows = Array.from({ length: 300 }, (_, i) => row(i === 299 ? 'id-0' : 'id-' + i, i));
    applyCsvTableIndexDraft(
      state,
      csvTableIndex(rows.slice(0, 240), { rowKeys: rows.map((r) => r.rowKey), validationRows: rows, totalRows: 300 }),
    );
    applyCsvTableIndexDraft(state, csvTableIndex([], { rowKeys: ['row-3'], validationRows: rows }), true);
    expect(Object.keys(state.rows)).toHaveLength(240);
    expect(csvTableIssues(state)[0]!.message).toContain('序号：1、300');
    setCsvCellValueDraft(state, 'row-0', 'id', 'changed');
    expect(csvTableIssues(state)).toEqual([]);
  });
  it('tracks copy, movement, edits, deletion and history', () => {
    const state = document();
    replaceCsvTableDraft(state, [row('one', 0), row('two', 1)]);
    const { result, keys } = insertCsvRowsDraft(state, [row('one', 0)], 2);
    expect(csvTableIssues(state)[0]!.message).toContain('序号：1、3');
    moveCsvRowDraft(state, keys[0]!, 1);
    expect(csvTableIssues(state)[0]!.message).toContain('序号：1、2');
    setCsvCellValueDraft(state, keys[0]!, 'id', 'three');
    expect(csvTableIssues(state)).toEqual([]);
    const deleted = deleteCsvRowDraft(state, keys[0]!);
    applyCsvDraftEdit(state, deleted.historyEdit!, 'undo');
    expect(csvTableIssues(state)).toEqual([]);
    applyCsvDraftEdit(state, result.historyEdit!, 'undo');
    applyCsvDraftEdit(state, result.historyEdit!, 'redo');
    expect(csvTableIssues(state)).toHaveLength(1);
  });
  it('accepts a complete external identity baseline while a search is active', () => {
    const state = document();
    replaceCsvTableDraft(state, [row('one', 0), row('two', 1)]);
    acceptSavedCsvTableIndex(
      state,
      csvTableIndex([row('one', 0)], {
        rowKeys: ['row-0'],
        validationRows: [row('one', 0), row('one', 2)],
      }),
      true,
    );
    expect(state.rowOrder).toEqual(['row-0', 'row-2']);
    expect(csvTableIssues(state)[0]!.message).toContain('序号：1、2');
    expect(Object.keys(state.rows)).toEqual(['row-0']);
  });
  it('accepts external projections and saved row keys while retaining later edits', () => {
    const state = document();
    replaceCsvTableDraft(state, [row('one', 0), row('two', 1)]);
    acceptSavedCsvTableIndex(state, csvTableIndex([row('one', 0), row('one', 1)]));
    expect(csvTableIssues(state)).toHaveLength(1);
    const { keys } = insertCsvRowsDraft(state, [row('three', 2)], 2);
    const submitted = { ...state.rows[keys[0]!]!.data };
    setCsvCellValueDraft(state, keys[0]!, 'id', 'one');
    commitCsvTableSaveDraft(
      state,
      [{ rowKey: keys[0]!, action: 'upsert', row: submitted, isComment: false }],
      [{ previousKey: keys[0]!, nextKey: 'saved', rowIndex: 2 }],
    );
    expect(state.rows.saved!.data.id).toBe('one');
    expect(state.validationRows!.find((r) => r.rowKey === 'saved')!.data.id).toBe('three');
    expect(csvTableIssues(state)[0]!.message).toContain('3 条记录');
  });
});
