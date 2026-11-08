import { describe, expect, it } from 'vitest';
import { schemaDocumentIssues } from './schema-validation';
import type { FileSchema } from './schema.types';
import type { RowData } from '@/shared/types';

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
              { key: 'value', label: 'Value', type: 'float', numberFormat: 'starsector' },
            ],
          },
        },
      ],
    },
  ],
};

describe('document schema problems', () => {
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
