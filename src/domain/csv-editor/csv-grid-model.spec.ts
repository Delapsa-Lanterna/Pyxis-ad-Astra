import { csvDraftRow } from '@/test/csv-row';
import { describe, expect, it } from 'vitest';
import type { CsvDraftRow, RowData } from '@/shared/types';
import { createCsvGridColumns } from './csv-grid-model';

function loadedRows(count: number, fill: (index: number) => RowData): CsvDraftRow[] {
  return Array.from({ length: count }, (_, index) => csvDraftRow(fill(index), `key-${index}`));
}

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
