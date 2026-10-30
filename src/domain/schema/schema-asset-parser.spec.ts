import { describe, expect, it } from 'vitest';
import { parseCsvColumnSchemas, parseFileSchema } from './schema-asset-parser';
import { CSV_COLUMN_CONTROLS, type FileSchema } from './schema.types';

describe('schema asset validation', () => {
  it.each([{ imageDirectories: [] }, { imageDirectories: ['.'] }, { imageDirectories: ['graphics/icons', 'graphics/ships'] }])(
    'preserves image directories $imageDirectories in fields and CSV columns',
    ({ imageDirectories }) => {
      const root = { key: 'image', label: 'Image', type: 'path-image', imageDirectories };
      expect(parseFileSchema('images', { $schema: 'pyxis-ad-astra/field-schema/v1', id: 'images', root }).root).toEqual(root);
      const column = { key: 'icon', control: 'path-image', imageDirectories };
      expect(parseCsvColumnSchemas('ships', { $schema: 'pyxis-ad-astra/csv-columns/v1', table: 'ships', columns: [column] })).toEqual([
        column,
      ]);
    },
  );
  it.each([null, 'graphics', [''], ['../outside'], ['/absolute'], ['graphics/../outside'], ['graphics\\icons']])(
    'rejects invalid directory declarations %j',
    (imageDirectories) => {
      expect(() =>
        parseFileSchema('images', {
          $schema: 'pyxis-ad-astra/field-schema/v1',
          id: 'images',
          root: { key: 'icon', label: 'Icon', type: 'path-image', imageDirectories },
        }),
      ).toThrow('imageDirectories');
    },
  );
  it('assigns explicit image directories to every bundled image declaration', () => {
    const assets = import.meta.glob('../../../schemas/**/*.schema.json', { eager: true, import: 'default' });
    let images = 0,
      empty = 0,
      files = 0;
    function visit(value: unknown) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const field = value as Record<string, unknown>;
      if (field.type === 'path-image' || field.control === 'path-image') {
        images++;
        expect(Array.isArray(field.imageDirectories)).toBe(true);
        if ((field.imageDirectories as string[]).length === 0) empty++;
      }
      Object.values(field).forEach(visit);
    }
    for (const asset of Object.values(assets)) {
      const before = images;
      visit(asset);
      if (images !== before) files++;
    }
    expect({ images, empty, files }).toEqual({ images: 46, empty: 3, files: 18 });
  });
  const fieldSchema = {
    $schema: 'pyxis-ad-astra/field-schema/v1',
    id: 'sample',
    sections: [{ id: 'main', label: 'Main', fields: [{ key: 'name', label: 'Name', type: 'string' }] }],
  };
  it.each([true, false])('preserves explicit expansion permission %s at each object level', (allowed) => {
    const root = {
      key: 'file',
      label: 'File',
      type: 'object',
      allowExtraFields: allowed,
      nested: [{ key: 'child', label: 'Child', type: 'object' }],
      valueSchema: { key: 'entry', label: 'Entry', type: 'object', allowExtraFields: !allowed },
    };
    const asset = { ...fieldSchema, allowExtraFields: allowed, root };
    expect(parseFileSchema('sample', asset)).toEqual(asset);
  });
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

  it('preserves numeric required conditions and rejects malformed thresholds', () => {
    const asset = { ...fieldSchema, root: { key: 'length', label: 'Length', type: 'float', requiredWhen: { particleCount: { min: 1 } } } };
    expect(parseFileSchema('sample', asset).root!.requiredWhen).toEqual({ particleCount: { min: 1 } });
    expect(() => parseFileSchema('sample', { ...asset, root: { ...asset.root, requiredWhen: { particleCount: { min: '1' } } } })).toThrow();
  });
  it('validates entity and config sources in definitions and retains visibility branches', () => {
    for (const source of ['csv:projectiles.id', 'csv:variants.variantId', 'config:engineStyles']) {
      const asset = {
        ...fieldSchema,
        definitions: {
          reference: {
            key: 'reference',
            label: 'Reference',
            type: 'enum',
            source,
            visibleWhen: [{ missileType: ['MIRV'] }, { 'behaviorSpec.delay': { gt: 0 } }],
          },
        },
      };
      expect(parseFileSchema('sample', asset).definitions!.reference!.source).toBe(source);
      expect(() =>
        parseFileSchema('sample', { ...asset, definitions: { reference: { ...asset.definitions.reference, source: 'csv:unknown.id' } } }),
      ).toThrow();
    }
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
        $schema: 'pyxis-ad-astra/csv-columns/v1',
        table: 'ships',
        columns: [column],
      }),
    ).toEqual([column]);
    expect(
      parseCsvColumnSchemas('ships', {
        $schema: 'pyxis-ad-astra/csv-columns/v1',
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
    { $schema: 'pyxis-ad-astra/csv-columns/v1', table: 'other', columns: [] },
    { $schema: 'pyxis-ad-astra/csv-columns/v1', table: 'ships', columns: [{ key: 'x', control: 'invalid' }] },
    {
      $schema: 'pyxis-ad-astra/csv-columns/v1',
      table: 'ships',
      columns: [{ key: 'x', control: 'reference', source: 'config:missing' }],
    },
  ])('rejects invalid column assets: %j', (asset) => {
    expect(() => parseCsvColumnSchemas('ships', asset)).toThrow();
  });
});
