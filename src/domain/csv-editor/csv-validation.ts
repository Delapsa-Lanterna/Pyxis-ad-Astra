import type { CsvDraftRow, CsvTableKey, CsvTableState, CsvValidationContext, FieldProblem } from '@/shared/types';
import { cell } from '@/shared/lib/starsector';
import { csvDirtyCells } from './csv-dirty';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { csvRowProblems } from './csv-row-validation';
import { csvValidationRequest, isCsvBusinessRow } from './csv-rule-context';

interface CsvValidationDefinition {
  columns: string[];
  validate: (rows: readonly CsvDraftRow[]) => FieldProblem[];
}
function uniqueIdentities(rows: readonly CsvDraftRow[], columns = ['id'], table: CsvTableKey = 'ships'): FieldProblem[] {
  const groups = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const values = columns.map((key) => cell(row.data[key]));
    if (!isCsvBusinessRow(row, table)) return;
    const key = JSON.stringify(values);
    const positions = groups.get(key) ?? [];
    positions.push(index + 1);
    groups.set(key, positions);
  });
  return [...groups]
    .filter(([, positions]) => positions.length > 1)
    .map(([key, positions]) => ({
      severity: 'error',
      code: 'csv.identity_duplicate',
      path: `${rows[positions[0]! - 1]!.rowKey}/${columns[0]}`,
      message: `${columns.join(' + ')} ${key} 重复，共 ${positions.length} 行，行号：${positions.join('、')}。`,
    }));
}
const uniqueId: CsvValidationDefinition = { columns: ['id'], validate: uniqueIdentities };
export const csvValidationDefinitions: Record<CsvTableKey, CsvValidationDefinition> = {
  ships: uniqueId,
  weapons: uniqueId,
  hullmods: uniqueId,
  shipSystems: uniqueId,
  industries: uniqueId,
  skills: { columns: ['id'], validate: (rows) => uniqueIdentities(rows, ['id'], 'skills') },
  abilities: uniqueId,
  commodities: uniqueId,
  specialItems: uniqueId,
  submarkets: uniqueId,
  marketConditions: uniqueId,
  descriptions: { columns: ['id', 'type'], validate: (rows) => uniqueIdentities(rows, ['id', 'type']) },
  simOpponents: { columns: [], validate: () => [] },
  wings: {
    columns: ['id'],
    validate: (rows) => [
      ...uniqueIdentities(rows),
      ...rows.flatMap((row, index): FieldProblem[] => {
        const id = cell(row.data.id);
        return !row.isComment && id !== '' && !id.endsWith('_wing')
          ? [
              {
                severity: 'warning',
                code: 'csv.wing_suffix',
                path: row.rowKey,
                message: `第 ${index + 1} 行的 ID ${JSON.stringify(id)} 应以 _wing 结尾。`,
              },
            ]
          : [];
      }),
    ],
  },
};
for (const table of Object.keys(csvValidationDefinitions) as CsvTableKey[])
  csvValidationDefinitions[table] = { ...csvValidationDefinitions[table], columns: getCsvColumnSchemas(table).map((column) => column.key) };
export function csvValidationRows(state: CsvTableState): CsvDraftRow[] {
  // Untouched columns follow the formal baseline even when another field retains a local draft.
  const baseline = new Map(state.validationRows?.map((row) => [row.rowKey, row]));
  return state.rowOrder.map((key) => {
    const original = baseline.get(key)!;
    const edits = csvDirtyCells(state.dirty[key]);
    if (!edits) return original;
    const current = state.rows[key]!;
    return {
      rowKey: key,
      isComment: original && !Object.hasOwn(edits, state.header[0]!) ? original.isComment : current.isComment,
      data: Object.fromEntries(
        csvValidationDefinitions[state.table].columns.map((column) => [
          column,
          cell(original && !Object.hasOwn(edits, column) ? original.data[column] : current.data[column]),
        ]),
      ),
    };
  });
}
export function csvTableIssues(state: CsvTableState): FieldProblem[] {
  if (state.validationRows === null) return [];
  const rows = csvValidationRows(state);
  const context = state.validationKey === JSON.stringify(csvValidationRequest(state.table, rows)) ? state.validationContext : null;
  const deferred = new Set(
    rows
      .filter((row) => state.dirty[row.rowKey]?.action === 'upsert' && cell(row.data.id) !== cell(state.baselineRows[row.rowKey]?.data.id))
      .map((row) => cell(row.data.id)),
  );
  return csvTableProblems(state.table, rows, state.header, context, deferred);
}
export function csvTableProblems(
  table: CsvTableKey,
  rows: readonly CsvDraftRow[],
  header: readonly string[],
  context: CsvValidationContext | null,
  deferred?: ReadonlySet<string>,
): FieldProblem[] {
  return [...csvValidationDefinitions[table].validate(rows), ...csvRowProblems(table, rows, header, context, deferred)];
}
