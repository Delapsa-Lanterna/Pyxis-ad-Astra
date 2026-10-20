import { describe, expect, it } from 'vitest';
import { TABLE_KEYS, type CsvTableKey } from '@/shared/types';
import {
  csvBooleanDisplayValue,
  csvBooleanOptions,
  csvColumnControl,
  csvColumnControlLabel,
  csvColumnSchemaFor,
  csvColumnsForTable,
  csvColumnSchemasForTable,
  csvControlUsesNativeInput,
  csvControlUsesPicker,
  csvListValues,
  formatCsvListValue,
  isCsvListControl,
  isCsvReferenceControl,
} from './csv-column-schema';
import { CSV_COLUMN_CONTROLS } from '@/domain/schema/schema.types';

describe('table column schemas', () => {
  it.each(TABLE_KEYS)('orders %s by schema and appends custom columns in header order', (table) => {
    const keys = csvColumnSchemasForTable(table).map((schema) => schema.key);
    const header = ['custom-z', ...keys.toReversed(), 'custom-a'];
    expect(csvColumnsForTable(table, header)).toEqual([...keys, 'custom-z', 'custom-a']);
    expect(header).toEqual(['custom-z', ...keys.toReversed(), 'custom-a']);
    const subset = keys.filter((_, index) => index % 2 === 0);
    expect(csvColumnsForTable(table, subset.toReversed())).toEqual(subset);
    expect(csvColumnsForTable(table, [])).toEqual([]);
  });

  it('keeps unique business keys and skips blank header entries', () => {
    expect(csvColumnsForTable('ships', ['constructor', '', 'id', '__proto__', 'id', '_custom'])).toEqual([
      'id',
      'constructor',
      '__proto__',
      '_custom',
    ]);
  });

  it('returns the registered schemas of a table', () => {
    const schemas = csvColumnSchemasForTable('ships');
    expect(schemas.length).toBeGreaterThan(0);
    expect(csvColumnSchemaFor('ships', 'id')?.control).toBe('text');
    expect(csvColumnSchemaFor('ships', 'shield type')?.control).toBe('enum');
  });

  it('returns null for unregistered columns and empty schemas for unknown tables', () => {
    expect(csvColumnSchemaFor('ships', 'nope')).toBeNull();
    expect(csvColumnSchemasForTable('nope' as CsvTableKey)).toEqual([]);
  });
});

describe('list value formatting', () => {
  it('splits comma lists and drops blank entries', () => {
    expect(csvListValues('a, b,,c')).toEqual(['a', 'b', 'c']);
    expect(csvListValues('')).toEqual([]);
    expect(csvListValues(' , ')).toEqual([]);
  });

  it('formats values back with a normalized separator', () => {
    expect(formatCsvListValue(['a', 'b'])).toBe('a, b');
    expect(formatCsvListValue([])).toBe('');
  });
});

describe('boolean display', () => {
  it('normalizes true/false spellings and keeps unknown values', () => {
    expect(csvBooleanDisplayValue('')).toBe('-');
    expect(csvBooleanDisplayValue('true')).toBe('true');
    expect(csvBooleanDisplayValue('FALSE')).toBe('false');
    expect(csvBooleanDisplayValue('maybe')).toBe('maybe');
  });

  it('exposes TRUE/FALSE picker options as copies', () => {
    const options = csvBooleanOptions();
    expect(options).toEqual([
      { label: 'TRUE', value: 'TRUE' },
      { label: 'FALSE', value: 'FALSE' },
    ]);
    options.push({ label: 'X', value: 'X' });
    expect(csvBooleanOptions()).toHaveLength(2);
  });
});

describe('control classification', () => {
  it('defaults to the text control without a schema', () => {
    expect(csvColumnControl(null)).toBe('text');
    expect(csvColumnControl(undefined)).toBe('text');
  });

  it('partitions every control into native input or picker', () => {
    for (const control of CSV_COLUMN_CONTROLS) {
      expect(csvControlUsesNativeInput(control) || csvControlUsesPicker(control), control).toBe(true);
      expect(csvControlUsesNativeInput(control) && csvControlUsesPicker(control), control).toBe(false);
    }
  });

  it('classifies list and reference controls', () => {
    expect(isCsvListControl('tags')).toBe(true);
    expect(isCsvListControl('multi')).toBe(true);
    expect(isCsvListControl('text')).toBe(false);
    expect(isCsvReferenceControl('reference')).toBe(true);
    expect(isCsvReferenceControl('enum')).toBe(false);
  });

  it('labels every control in Chinese', () => {
    expect(csvColumnControlLabel('number')).toBe('数值');
    expect(csvColumnControlLabel('boolean')).toBe('布尔');
    expect(csvColumnControlLabel('enum')).toBe('枚举');
    expect(csvColumnControlLabel('reference')).toBe('引用');
    expect(csvColumnControlLabel('tags')).toBe('标签');
    expect(csvColumnControlLabel('multi')).toBe('多值');
    expect(csvColumnControlLabel('path-image')).toBe('图片路径');
    expect(csvColumnControlLabel('color')).toBe('颜色');
    expect(csvColumnControlLabel('text')).toBe('文本');
  });
});
