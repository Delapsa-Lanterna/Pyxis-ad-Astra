import { describe, expect, it } from 'vitest';
import backendSources from '../../../src-tauri/src/domain/schema_sources.rs?raw';
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
