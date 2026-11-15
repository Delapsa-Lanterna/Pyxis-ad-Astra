import { parseValueCatalog } from './schema-asset-parser';
import type { FieldSchema, ValueCatalog } from './schema.types';

const CATALOGS: Record<string, ValueCatalog> = Object.fromEntries(
  Object.entries(import.meta.glob<unknown>('../../../schemas/value-catalogs/*.json', { eager: true, import: 'default' })).map(
    ([path, asset]) => {
      const id = path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
      return [id, parseValueCatalog(id, asset)];
    },
  ),
);

export function valueCatalog(id: string): ValueCatalog {
  return CATALOGS[id]!;
}

export function schemaCatalogOptions(field: Pick<FieldSchema, 'optionCatalog' | 'options'>) {
  return (field.options ?? []).map((value) => {
    const entry = field.optionCatalog ? valueCatalog(field.optionCatalog).values[value]! : undefined;
    return entry ? { value, label: `${value} (${entry.label})`, description: entry.description } : { value, label: value };
  });
}

export function validateOptionCatalog(field: Pick<FieldSchema, 'optionCatalog' | 'options' | 'suggestions' | 'optionPatterns'>): void {
  if (!field.optionCatalog) return;
  const catalog = CATALOGS[field.optionCatalog];
  if (!catalog) throw new Error(`取值目录不存在: ${field.optionCatalog}`);
  for (const value of [...(field.options ?? []), ...(field.suggestions ?? [])])
    if (!Object.hasOwn(catalog.values, value)) throw new Error(`取值目录 ${catalog.id} 缺少 ${value} 的名称和说明`);
  for (const prefix of field.optionPatterns ?? [])
    if (!catalog.patterns.some((pattern) => pattern.prefix === prefix)) throw new Error(`取值目录 ${catalog.id} 缺少 ${prefix} 数字模板`);
}
