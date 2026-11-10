import { describe, expect, it } from 'vitest';
import { schemaDocumentIssues } from './schema-validation';
import type { FileSchema } from './schema.types';
import type { RowData } from '@/shared/types';
import { getSchema } from './config-schema-registry';
import { getCsvColumnSchemas } from './csv-schema-registry';
import { csvValueError, parseCsvValue } from './csv-value-validation';
import { schemaFieldIssues } from './schema-validation';

const schema: FileSchema = {
  $schema: 'pyxis-ad-astra/field-schema/v1',
  id: 'validation-fixture',
  sections: [
    {
      id: 'main',
      label: 'Main',
      fields: [
        { key: 'file.name', label: 'Name', type: 'string', required: true },
        {
          key: 'file.groups',
          label: 'Groups',
          type: 'array',
          item: {
            key: 'group',
            label: 'Group',
            type: 'object',
            nested: [
              { key: 'count', label: 'Count', type: 'integer', required: true },
              { key: 'value', label: 'Value', type: 'float' },
            ],
          },
        },
      ],
    },
  ],
};

describe('document schema problems', () => {
  it('delivers resolved references to every schema consumer', () => {
    const type = getSchema('spec-weapon')!
      .sections!.flatMap((section) => section.fields)
      .find((field) => field.key === 'type')!;
    expect(type.ref).toBeUndefined();
    expect(schemaFieldIssues(type, 'UNREGISTERED')).toHaveLength(1);
    expect(type.options).toContain('BALLISTIC');
  });
  it('collects object cardinality, exclusive-key, dictionary-key and supplied null errors', () => {
    const root: FileSchema = {
      id: 'objects',
      root: {
        key: 'file',
        label: 'File',
        type: 'object',
        allowExtraFields: true,
        keySchema: { key: 'index', label: 'Index', type: 'integer', min: 0 },
        valueSchema: { key: 'value', label: 'Value', type: 'object', minEntries: 1, maxEntries: 1, exclusiveKeys: ['a', 'b'] },
      },
    };
    const issues = schemaDocumentIssues(root, { file: { '-1': {}, '2': { a: 1, b: 2 } } });
    expect(issues.map((issue) => issue.path).sort()).toEqual(['file["-1"]', 'file["-1"]', 'file["-1"]', 'file["2"]', 'file["2"]'].sort());
    expect(schemaFieldIssues({ key: 'count', label: 'Count', type: 'integer' }, null)).toHaveLength(1);
  });
  it('keeps omitted nested array fields partial and rejects supplied wrong types', () => {
    expect(schemaDocumentIssues(schema, { file: { groups: [{}] } }, true)).toEqual([]);
    expect(schemaDocumentIssues(schema, { file: { groups: [{ count: false }] } }, true).map((issue) => issue.path)).toEqual([
      'file.groups[0]["count"]',
    ]);
  });
  it.each([
    ['2e2', 200],
    ['2f', 2],
    ['-1', -1],
    ['2147483647', 2147483647],
  ])('preserves CSV OP original %s and shares its numeric meaning %s', (raw, value) => {
    const column = getCsvColumnSchemas('weapons').find((column) => column.key === 'OPs')!;
    expect(parseCsvValue(column, String(raw))).toEqual({ kind: 'value', raw: String(raw), value });
    expect(csvValueError(column, String(raw))).toBeNull();
  });
  it.each(['1.5', '2147483648', 'Infinity', '1e'])('rejects CSV integer input %s through the same rule', (raw) => {
    const column = getCsvColumnSchemas('weapons').find((column) => column.key === 'OPs')!;
    expect(parseCsvValue(column, raw).kind).toBe('error');
    expect(csvValueError(column, raw)).not.toBeNull();
  });
  it('checks unmounted nested fields and preserves source values', () => {
    const content: RowData = { file: { name: 'Fixture', groups: [{ count: 'bad', value: '2.5f' }, {}] } };
    const before = JSON.stringify(content);
    expect(schemaDocumentIssues(schema, content).map((issue) => issue.path)).toEqual([
      'file.groups[0]["count"]',
      'file.groups[1]["count"]',
    ]);
    expect(JSON.stringify(content)).toBe(before);
  });
  it('allows omitted partial fields while checking every provided value', () => {
    expect(schemaDocumentIssues(schema, { file: {} }, true)).toEqual([]);
    expect(schemaDocumentIssues(schema, { file: { name: 8 } }, true).map((issue) => issue.path)).toEqual(['file.name']);
    expect(schemaDocumentIssues(schema, { file: {} }).map((issue) => issue.path)).toEqual(['file.name']);
  });
  it('checks a root collection and keeps dictionary keys distinct from path separators', () => {
    const root: FileSchema = {
      $schema: schema.$schema,
      id: 'root-fixture',
      root: {
        key: 'file',
        label: 'File',
        type: 'object',
        allowExtraFields: true,
        valueSchema: { key: 'value', label: 'Value', type: 'integer' },
      },
    };
    expect(schemaDocumentIssues(root, { file: { 'group.a/b': 'invalid' } }).map((issue) => issue.path)).toEqual(['file["group.a/b"]']);
  });
});
