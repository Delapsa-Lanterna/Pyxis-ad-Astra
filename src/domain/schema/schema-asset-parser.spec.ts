import { describe, expect, it } from 'vitest';
import { parseCsvColumnSchemas, parseFileSchema } from './schema-asset-parser';

describe('schema asset validation', () => {
  const fieldSchema = {
    $schema: 'circinus-ad-astra/field-schema/v1',
    id: 'sample',
    sections: [{ id: 'main', label: 'Main', fields: [{ key: 'name', label: 'Name', type: 'string' }] }],
  };
  it.each([
    { ...fieldSchema, $schema: 'invalid' },
    { ...fieldSchema, sections: [] },
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
  ])('rejects invalid column assets: %j', (asset) => {
    expect(() => parseCsvColumnSchemas('ships', asset)).toThrow();
  });
});
