import { describe, expect, it } from 'vitest';
import { csvDraftSearchKeys, csvSearchOptions, csvSearchPlaceholder, DEFAULT_CSV_SEARCH_FIELD } from './csv-search';
import { csvDraftRow } from '@/test/fixtures/csv-row';

describe('CSV search field projection', () => {
  it.each(csvSearchOptions('ships', ['id', 'name', 'tags']).map((option) => option.value))(
    'merges draft matches and preserves draft order for %s',
    (field) => {
      const column = field === 'id-name' ? 'name' : field;
      const drafts = [csvDraftRow({ [column]: 'changed' }, 'old'), csvDraftRow({ [column]: 'Local_MATCH' }, 'new')];
      expect(csvDraftSearchKeys('ships', ['new', 'saved', 'old'], drafts, ['old', 'deleted', 'saved'], ' match ', field)).toEqual([
        'new',
        'saved',
      ]);
    },
  );
  it('uses variant identities for simulator opponents and leaves inputs intact', () => {
    const row = csvDraftRow({ 'variant id': 'Sample', id: 'Other' }, 'variant');
    expect(csvDraftSearchKeys('simOpponents', ['variant'], [row], [], 'sample', 'id')).toEqual(['variant']);
    expect(row.data).toEqual({ 'variant id': 'Sample', id: 'Other' });
  });
  it('offers the four declared fields in order and defaults to ID/name', () => {
    expect(DEFAULT_CSV_SEARCH_FIELD).toBe('id-name');
    expect(csvSearchOptions('ships', ['tags', 'name', 'id', 'description'])).toEqual([
      { label: 'ID/名称', value: 'id-name' },
      { label: 'ID', value: 'id' },
      { label: '名称', value: 'name' },
      { label: 'tags', value: 'tags' },
    ]);
  });
  it.each([
    ['ships', ['id'], ['id-name', 'id']],
    ['ships', ['name', 'tags'], ['id-name', 'name', 'tags']],
    ['simOpponents', ['variant id'], ['id-name', 'id']],
    ['simOpponents', ['id'], []],
    ['descriptions', ['id', 'text1'], ['id-name', 'id']],
    ['ships', [], []],
  ] as const)('projects %s options only from the actual header %j', (table, header, expected) => {
    expect(csvSearchOptions(table, header).map((option) => option.value)).toEqual(expected);
  });
  it('projects each field into its search prompt', () => {
    expect(csvSearchOptions('ships', ['id', 'name', 'tags']).map(({ value }) => csvSearchPlaceholder(value))).toEqual([
      '搜索 ID/名称',
      '搜索 ID',
      '搜索 名称',
      '搜索 tags',
    ]);
  });
});
