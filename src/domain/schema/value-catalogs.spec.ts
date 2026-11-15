import { describe, expect, it } from 'vitest';
import { getSchema } from './config-schema-registry';
import { getCsvColumnSchemas } from './csv-schema-registry';
import { parseValueCatalog } from './schema-asset-parser';
import { schemaCatalogOptions, validateOptionCatalog, valueCatalog } from './value-catalogs';
import type { FieldSchema } from './schema.types';
import { TABLE_KEYS } from '@/shared/types';

describe('value catalogs', () => {
  it('loads every scoped catalog with labels and descriptions', () => {
    const assets = import.meta.glob('../../../schemas/value-catalogs/*.json', { eager: true, import: 'default' });
    expect(Object.keys(assets)).toHaveLength(41);
    let entries = 0;
    for (const [path, raw] of Object.entries(assets)) {
      const id = path.slice(path.lastIndexOf('/') + 1, -5);
      const catalog = parseValueCatalog(id, raw);
      expect(valueCatalog(id)).toEqual(catalog);
      entries += Object.keys(catalog.values).length;
      for (const entry of [...Object.values(catalog.values), ...catalog.patterns]) {
        expect(entry.label.trim().length).toBeGreaterThan(0);
        expect(entry.description.trim().length).toBeGreaterThan(0);
      }
    }
    expect(entries).toBe(572);
  });

  it('covers every fixed field and all CSV tag domains through their schema declarations', () => {
    const assets = import.meta.glob('../../../schemas/*.schema.json');
    let fixed = 0;
    function visit(field: FieldSchema) {
      if (field.options?.length) {
        expect(field.optionCatalog).toBeTruthy();
        validateOptionCatalog(field);
        fixed++;
      }
      for (const child of [...(field.nested ?? []), ...(field.variants ?? []), field.item, field.valueSchema, field.keySchema])
        if (child) visit(child);
    }
    for (const path of Object.keys(assets)) {
      const schema = getSchema(path.slice(path.lastIndexOf('/') + 1, -'.schema.json'.length))!;
      for (const field of [schema.root, ...Object.values(schema.definitions ?? {}), ...(schema.sections ?? []).flatMap((s) => s.fields)])
        if (field) visit(field);
    }
    const domains = TABLE_KEYS.flatMap((table) =>
      getCsvColumnSchemas(table).filter((column) => ['tags', 'hints', 'uiTags'].includes(column.key)),
    );
    expect(domains).toHaveLength(14);
    for (const field of domains) {
      expect(field.optionCatalog).toBeTruthy();
      validateOptionCatalog(field);
      expect(field.options ?? field.suggestions).toEqual(expect.arrayContaining(Object.keys(valueCatalog(field.optionCatalog!).values)));
    }
    expect(fixed).toBeGreaterThan(43);
  });

  it('uses each field subset and schema order for a shared damage catalog', () => {
    const system = getSchema('spec-system')!
      .sections!.flatMap((section) => section.fields)
      .find((field) => field.key === 'damageType')!;
    const weapon = getCsvColumnSchemas('weapons').find((field) => field.key === 'type')!;
    expect(schemaCatalogOptions(system).map((option) => option.value)).toEqual(['ENERGY', 'KINETIC', 'HIGH_EXPLOSIVE', 'FRAGMENTATION']);
    expect(schemaCatalogOptions(weapon).map((option) => option.value)).toEqual([
      'KINETIC',
      'ENERGY',
      'HIGH_EXPLOSIVE',
      'FRAGMENTATION',
      'OTHER',
    ]);
    expect(schemaCatalogOptions({ optionCatalog: 'damage-types', options: ['OTHER', 'KINETIC'] })).toEqual([
      { value: 'OTHER', label: 'OTHER (其它)', description: '用于发射器等不适用常规伤害分类的内容。' },
      { value: 'KINETIC', label: 'KINETIC (动能)', description: '对护盾造成 200% 伤害，对装甲造成 50% 伤害，对船体造成 100% 伤害。' },
    ]);
  });

  it('retains scoped meanings, the current ship hint and numeric templates', () => {
    expect(getCsvColumnSchemas('ships').find((field) => field.key === 'hints')!.options).toContain('DO_NOT_TURN_TO_ARMOR');
    expect(valueCatalog('skill-tags').values.phase!.description).not.toEqual(valueCatalog('hullmod-tags').values.phase!.description);
    expect(valueCatalog('weapon-tags').patterns).toHaveLength(11);
    expect(valueCatalog('wing-tags').patterns).toHaveLength(4);
    expect(valueCatalog('weapon-tags').patterns.find((pattern) => pattern.prefix === 'substrate_')!.max).toBe(2147483647);
    const wing = getCsvColumnSchemas('wings').find((field) => field.key === 'formation')!;
    expect(wing.optionCatalog).toBe('wing-formations');
    expect(schemaCatalogOptions(wing).map((option) => option.label)).toEqual(['CLAW (爪形)', 'V (V 形)', 'BOX (箱形)', 'DIAMOND (菱形)']);
  });

  it.each([
    { optionCatalog: 'absent' },
    { optionCatalog: 'damage-types', options: ['absent'] },
    { optionCatalog: 'weapon-tags', optionPatterns: ['absent'] },
  ])('rejects unresolved schema declarations %j', (field) => {
    expect(() => validateOptionCatalog(field)).toThrow();
  });

  it.each([
    { $schema: 'invalid', id: 'sample', values: {} },
    { $schema: 'pyxis-ad-astra/value-catalog/v1', id: 'sample', values: { sample: { label: '', description: 'Sample' } } },
    { $schema: 'pyxis-ad-astra/value-catalog/v1', id: 'sample', values: {}, patterns: [{ prefix: 'sample', max: -1 }] },
  ])('rejects malformed catalog assets %j', (asset) => {
    expect(() => parseValueCatalog('sample', asset)).toThrow();
  });
});
