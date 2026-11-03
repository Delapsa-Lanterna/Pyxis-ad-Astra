import { TABLE_KEYS, type CsvTableKey } from '@/shared/types';

export const CONFIG_FIELD_SOURCES = {
  'config:sounds': 'data/config/sounds.json',
  'config:designTypes': 'data/config/settings.json',
  'config:hullStyles': 'data/config/hull_styles.json',
  'config:engineStyles': 'data/config/engine_styles.json',
} as const;

export const ENTITY_FIELD_SOURCES = ['csv:projectiles.id', 'csv:variants.variantId'] as const;
export function isEntityFieldSource(source: string | undefined | null): boolean {
  return ENTITY_FIELD_SOURCES.some((registered) => registered === source);
}

export function isConfigFieldSource(source: string | undefined): source is keyof typeof CONFIG_FIELD_SOURCES {
  return source !== undefined && Object.hasOwn(CONFIG_FIELD_SOURCES, source);
}

export interface ParsedCsvFieldSource {
  column: string;
  table: CsvTableKey;
}

const tableKeys = new Set<string>(TABLE_KEYS);

export function parseCsvFieldSource(source: string | undefined | null): ParsedCsvFieldSource | null {
  if (!source) return null;
  const trimmed = source.startsWith('csv:') ? source.slice(4) : source;
  const separator = trimmed.indexOf('.');
  if (separator <= 0 || separator === trimmed.length - 1) return null;
  const table = trimmed.slice(0, separator);
  if (!tableKeys.has(table)) return null;
  return { table: table as CsvTableKey, column: trimmed.slice(separator + 1) };
}

export function isCsvFieldSource(source: string | undefined | null): boolean {
  return Boolean(parseCsvFieldSource(source));
}
