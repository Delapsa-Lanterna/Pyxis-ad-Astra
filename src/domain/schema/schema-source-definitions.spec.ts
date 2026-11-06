import { describe, expect, it } from 'vitest';
import backendSources from '../../../src-tauri/src/domain/schema_sources.rs?raw';
import entityDefinitions from '../../../src-tauri/src/services/project/definitions/entity_definitions.rs?raw';
import { getCsvColumnSchemas } from './csv-schema-registry';
import { TABLE_KEYS } from '@/shared/types';
import {
  CONFIG_FIELD_SOURCES,
  ENTITY_FIELD_SOURCES,
  parseCsvFieldSource,
  isCsvFieldSource,
  isEntityFieldSource,
  isConfigFieldSource,
} from './schema-source-definitions';

describe('field source definitions', () => {
  it('resolves every bundled source against the frontend and backend registries', () => {
    const assets = import.meta.glob('../../../schemas/**/*.schema.json', { eager: true, import: 'default' });
    const registered = [...entityDefinitions.matchAll(/source_options: &\[([^\]]*)\]/g)].flatMap((match) =>
      [...match[1]!.matchAll(/"([^"]+)"/g)].map((item) => item[1]),
    );
    function visit(value: unknown) {
      if (!value || typeof value !== 'object') return;
      const source = (value as { source?: unknown }).source;
      if (typeof source === 'string' && source.startsWith('csv:')) {
        const csv = parseCsvFieldSource(source);
        if (csv)
          expect(
            getCsvColumnSchemas(csv.table).some((column) => column.key === csv.column),
            source,
          ).toBe(true);
        else {
          expect(isEntityFieldSource(source), source).toBe(true);
          expect(registered, source).toContain(source.slice(4));
        }
      }
      if (typeof source === 'string' && source.startsWith('config:')) expect(isConfigFieldSource(source), source).toBe(true);
      Object.values(value).forEach(visit);
    }
    Object.values(assets).forEach(visit);
  });
  it.each(TABLE_KEYS)('resolves the registered %s table with both source spellings', (table) => {
    for (const source of [table + '.id', 'csv:' + table + '.id']) {
      expect(parseCsvFieldSource(source)).toEqual({ table, column: 'id' });
      expect(isCsvFieldSource(source)).toBe(true);
    }
  });
  it.each([null, undefined, '', 'ships', '.id', 'ships.', 'csv:unknown.id'])(
    'rejects incomplete or unregistered table source %s',
    (source) => {
      expect(parseCsvFieldSource(source)).toBeNull();
      expect(isCsvFieldSource(source)).toBe(false);
    },
  );
  it.each(ENTITY_FIELD_SOURCES)('recognizes entity catalog %s', (source) => {
    expect(isEntityFieldSource(source)).toBe(true);
    expect(isCsvFieldSource(source)).toBe(false);
  });
  it('uses the same configuration source names and paths in both languages', () => {
    const entries = [...backendSources.matchAll(/\(\s*"(config:[^"]+)"\s*,\s*"([^"]+)"/g)].map((match) => [match[1], match[2]]);
    expect(entries).toHaveLength(4);
    expect(CONFIG_FIELD_SOURCES).toEqual(Object.fromEntries(entries));
    for (const source of Object.keys(CONFIG_FIELD_SOURCES)) expect(isConfigFieldSource(source)).toBe(true);
    expect(isConfigFieldSource('config:unknown')).toBe(false);
    expect(isEntityFieldSource('csv:ships.id')).toBe(false);
  });
});
