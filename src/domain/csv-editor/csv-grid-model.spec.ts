import { csvDraftRow } from '@/test/fixtures/csv-row';
import { describe, expect, it } from 'vitest';
import type { CsvDraftRow, RowData } from '@/shared/types';
import { createCsvGridColumns, csvRenderColumns, type CsvGridColumn } from './csv-grid-model';
import { TABLE_KEYS } from '@/shared/types';

function loadedRows(count: number, fill: (index: number) => RowData): CsvDraftRow[] {
  return Array.from({ length: count }, (_, index) => csvDraftRow(fill(index), `key-${index}`));
}

describe('CSV column viewport', () => {
  const columns = Array.from({ length: 8 }, (_, index): CsvGridColumn => ({
    key: String(index),
    className: '',
    enumOptions: [],
    schema: null,
    widthPx: 100,
  }));
  it.each([
    [0, 116, ['0', '1']],
    [100, 116, ['0', '1', '2']],
    [101, 116, ['0', '1', '2', '3']],
    [600, 216, ['5', '6', '7']],
    [0, 816, ['0', '1', '2', '3', '4', '5', '6', '7']],
    [0, 0, []],
  ])('projects the viewport at %s with width %s', (left, width, expected) => {
    const views = csvRenderColumns(columns, left, width, undefined);
    expect(views.map((view) => view.column.key)).toEqual(expected);
    expect(views.map((view) => view.gridColumn)).toEqual(expected.map((key) => Number(key) + 2));
    expect(views.map((view) => view.offsetPx)).toEqual(expected.map((key) => Number(key) * 100 + 16));
  });
  it('retains an active column and reuses an unchanged range', () => {
    const first = csvRenderColumns(columns, 400, 100, '0');
    expect(first.map((view) => view.column.key)).toEqual(['0', '3', '4', '5']);
    expect(csvRenderColumns(columns, 401, 100, '0', first)).toBe(first);
    const updated = columns.map((column) => ({ ...column, widthPx: 120 }));
    expect(csvRenderColumns(updated, 401, 100, '0', first)).not.toBe(first);
    expect(csvRenderColumns(columns, 400, 100, undefined, first).map((view) => view.column.key)).toEqual(['3', '4', '5']);
  });
  it.each(TABLE_KEYS)('uses the same projection for %s', (table) => {
    const model = createCsvGridColumns(table, ['id', 'custom'], []);
    expect(csvRenderColumns(model.columns, 0, model.totalWidthPx + 16, undefined).map((view) => view.column.key)).toEqual(['id', 'custom']);
  });
});

describe('createCsvGridColumns rows', () => {
  it('preserves the row count in the grid model', () => {
    const model = createCsvGridColumns(
      'ships',
      ['id'],
      loadedRows(4, () => ({ id: 'x' })),
    );
    expect(model.columns.map((column) => column.key)).toEqual(['id']);
    expect(model.totalWidthPx).toBe(model.columns[0]!.widthPx);
  });
});

describe('createCsvGridColumns columns', () => {
  it('resolves the registered column schema and enum options', () => {
    const model = createCsvGridColumns('ships', ['shield type'], []);
    expect(model.columns).toHaveLength(1);
    expect(model.columns[0]!.key).toBe('shield type');
    expect(model.columns[0]!.schema?.control).toBe('enum');
    expect(model.columns[0]!.className).toBe('schema-col-enum');
    expect(model.columns[0]!.enumOptions.map((option) => option.value)).toEqual(['NONE', 'FRONT', 'OMNI', 'PHASE']);
  });

  it('falls back to the text control for unregistered columns', () => {
    const model = createCsvGridColumns('ships', ['not-in-schema'], []);
    expect(model.columns[0]!.schema).toBeNull();
    expect(model.columns[0]!.className).toBe('schema-col-text');
    expect(model.columns[0]!.enumOptions).toEqual([]);
  });

  it('keeps text column widths inside the text clamp range', () => {
    const longName = 'x'.repeat(80);
    const model = createCsvGridColumns(
      'ships',
      ['name'],
      loadedRows(1, () => ({ name: longName })),
    );
    const width = model.columns[0]!.widthPx;
    expect(width).toBeGreaterThanOrEqual(64);
    expect(width).toBeLessThanOrEqual(260);
    expect(model.totalWidthPx).toBe(width);
  });

  it('keeps enum column widths inside the enum clamp range', () => {
    const model = createCsvGridColumns('ships', ['shield type'], []);
    expect(model.columns[0]!.widthPx).toBeGreaterThanOrEqual(88);
    expect(model.columns[0]!.widthPx).toBeLessThanOrEqual(240);
  });

  it('keeps tag column widths inside the tag clamp range', () => {
    const model = createCsvGridColumns(
      'ships',
      ['tags'],
      loadedRows(1, () => ({ tags: 'a,b,c,d,e' })),
    );
    expect(model.columns[0]!.widthPx).toBeGreaterThanOrEqual(160);
    expect(model.columns[0]!.widthPx).toBeLessThanOrEqual(560);
  });

  it('sums every column width into totalWidthPx', () => {
    const model = createCsvGridColumns('ships', ['name', 'id', 'shield type'], []);
    expect(model.totalWidthPx).toBe(model.columns.reduce((sum, column) => sum + column.widthPx, 0));
  });
});
