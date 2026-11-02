import type { CsvSearchField, CsvTableKey, CsvDraftRow } from '@/shared/types';

export const DEFAULT_CSV_SEARCH_FIELD: CsvSearchField = 'id-name';

const SEARCH_LABELS: Record<CsvSearchField, string> = {
  'id-name': 'ID/名称',
  id: 'ID',
  name: '名称',
  tags: 'tags',
};

export function csvSearchOptions(table: CsvTableKey, header: readonly string[]): Array<{ label: string; value: CsvSearchField }> {
  const idField = table === 'simOpponents' ? 'variant id' : 'id';
  const fields: CsvSearchField[] = [];
  if (header.includes(idField) || header.includes('name')) fields.push('id-name');
  if (header.includes(idField)) fields.push('id');
  if (header.includes('name')) fields.push('name');
  if (header.includes('tags')) fields.push('tags');
  return fields.map((value) => ({ label: SEARCH_LABELS[value], value }));
}

export function csvSearchPlaceholder(field: CsvSearchField): string {
  return `搜索 ${SEARCH_LABELS[field]}`;
}

export function csvDraftSearchKeys(
  table: CsvTableKey,
  order: readonly string[],
  drafts: readonly CsvDraftRow[],
  matches: readonly string[],
  search: string,
  field: CsvSearchField,
) {
  const selected = new Set(matches),
    query = search.trim().toLowerCase();
  const id = table === 'simOpponents' ? 'variant id' : 'id';
  const fields = field === 'id-name' ? [id, 'name'] : [field === 'id' ? id : field];
  for (const row of drafts) {
    if (fields.some((key) => typeof row.data[key] === 'string' && row.data[key].toLowerCase().includes(query))) selected.add(row.rowKey);
    else selected.delete(row.rowKey);
  }
  return order.filter((key) => selected.has(key));
}
