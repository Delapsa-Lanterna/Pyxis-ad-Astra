import { describe, expect, it } from 'vitest';
import { parseCsvColumnSchemas, parseFileSchema } from './schema-asset-parser';
import { CSV_COLUMN_CONTROLS, type FileSchema } from './schema.types';

describe('schema asset validation', () => {
  const fieldSchema = {
    $schema: 'circinus-ad-astra/field-schema/v1',
    id: 'sample',
    sections: [{ id: 'main', label: 'Main', fields: [{ key: 'name', label: 'Name', type: 'string' }] }],
  };
  it('preserves metadata, source declarations and recursive field contracts', () => {
    const asset: FileSchema = {
      ...fieldSchema,
      fileType: 'json',
      displayName: 'Sample',
      description: 'Sample fields',
      targetFile: 'sample.json',
      gameVersion: '1.0',
      sources: [
        { id: 'table', type: 'csv-row', path: 'data/sample.csv', keyField: 'id', extraFields: true },
        { id: 'spec', type: 'json-file', path: 'data/sample.json' },
        { id: 'text', type: 'text-file', path: 'data/sample.txt' },
      ],
      sections: [
        {
          id: 'main',
          label: 'Main',
          collapsed: true,
          fields: [
            {
              key: 'count',
              label: 'Count',
              type: 'integer',
              description: 'Item count',
              required: false,
              editable: false,
              default: 0,
              min: 0,
              max: 10,
              step: 1,
              warning: 'Check count',
              danger: 'Changes behavior',
            },
            {
              key: 'entries',
              label: 'Entries',
              type: 'array',
              item: {
                key: 'item',
                type: 'object',
                label: 'Entry',
                nested: [
                  {
                    key: 'system',
                    label: 'System',
                    type: 'enum',
                    source: 'csv:shipSystems.id',
                    options: ['sample'],
                  },
                ],
              },
            },
            { key: 'paths', label: 'Paths', type: 'array', item: { key: 'path', label: 'Path', type: 'path', pathBase: 'mission' } },
            {
              key: 'values',
              label: 'Values',
              type: 'object',
              format: 'array-of-entries',
              valueSchema: { key: 'value', label: 'Value', type: 'float', default: 0.5 },
            },
          ],
        },
      ],
    };
    expect(parseFileSchema('sample', structuredClone(asset))).toEqual(asset);
    expect(parseFileSchema('sample', fieldSchema)).toEqual(fieldSchema);
  });

  it.each(CSV_COLUMN_CONTROLS)('preserves %s column options including empty, false and zero values', (control) => {
    const column = {
      key: 'sample',
      control,
      label: 'Sample',
      source: 'csv:ships.id',
      options: ['first', 'second'],
      default: '',
      readonly: false,
      min: 0,
      max: 10,
      step: 0.5,
      priority: 0,
    };
    expect(
      parseCsvColumnSchemas('ships', {
        $schema: 'circinus-ad-astra/csv-columns/v1',
        table: 'ships',
        columns: [column],
      }),
    ).toEqual([column]);
    expect(
      parseCsvColumnSchemas('ships', {
        $schema: 'circinus-ad-astra/csv-columns/v1',
        table: 'ships',
        columns: [{ key: 'minimal', control }],
      }),
    ).toEqual([{ key: 'minimal', control }]);
  });

  it.each([
    { ...fieldSchema, $schema: 'invalid' },
    { ...fieldSchema, sections: [] },
    {
      ...fieldSchema,
      sections: [{ id: 'main', label: 'Main', fields: [{ key: 'x', label: 'X', type: 'enum', source: 'config:missing' }] }],
    },
    { ...fieldSchema, sections: [{ id: 'main', label: 'Main', fields: [{ key: 'x', label: 'X', type: 'invalid' }] }] },
    {
      ...fieldSchema,
      sections: [{ id: 'main', label: 'Main', fields: [{ key: 'x', label: 'X', type: 'enum', source: 'csv:missing.id' }] }],
    },
  ])('rejects invalid field assets: %j', (asset) => {
    expect(() => parseFileSchema('sample', asset)).toThrow();
  });
  it.each([
    { $schema: 'invalid', table: 'ships', columns: [] },
    { $schema: 'circinus-ad-astra/csv-columns/v1', table: 'other', columns: [] },
    { $schema: 'circinus-ad-astra/csv-columns/v1', table: 'ships', columns: [{ key: 'x', control: 'invalid' }] },
    {
      $schema: 'circinus-ad-astra/csv-columns/v1',
      table: 'ships',
      columns: [{ key: 'x', control: 'reference', source: 'config:missing' }],
    },
  ])('rejects invalid column assets: %j', (asset) => {
    expect(() => parseCsvColumnSchemas('ships', asset)).toThrow();
  });
});
