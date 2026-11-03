import { describe, expect, it } from 'vitest';
import backendSources from '../../../src-tauri/src/services/project/query/source_catalog/config_sources.rs?raw';
import { TABLE_KEYS } from '@/shared/types';
import {
  CONFIG_OPTION_SOURCES,
  ENTITY_OPTION_SOURCES,
  parseCsvSource,
  isCsvSource,
  isEntitySource,
  isConfigSource,
} from './source-definitions';

describe('source catalog definitions', () => {
  it.each(TABLE_KEYS)('resolves the registered %s table with both source spellings', (table) => {
    for (const source of [table + '.id', 'csv:' + table + '.id']) {
      expect(parseCsvSource(source)).toEqual({ table, column: 'id' });
      expect(isCsvSource(source)).toBe(true);
    }
  });
  it.each([null, undefined, '', 'ships', '.id', 'ships.', 'csv:unknown.id'])(
    'rejects incomplete or unregistered table source %s',
    (source) => {
      expect(parseCsvSource(source)).toBeNull();
      expect(isCsvSource(source)).toBe(false);
    },
  );
  it.each(ENTITY_OPTION_SOURCES)('recognizes entity catalog %s', (source) => {
    expect(isEntitySource(source)).toBe(true);
    expect(isCsvSource(source)).toBe(false);
  });
  it('uses the same configuration source names and paths in both languages', () => {
    const entries = [...backendSources.matchAll(/\(\s*"(config:[^"]+)"\s*,\s*"([^"]+)"/g)].map((match) => [match[1], match[2]]);
    expect(entries).toHaveLength(4);
    expect(CONFIG_OPTION_SOURCES).toEqual(Object.fromEntries(entries));
    for (const source of Object.keys(CONFIG_OPTION_SOURCES)) expect(isConfigSource(source)).toBe(true);
    expect(isConfigSource('config:unknown')).toBe(false);
    expect(isEntitySource('csv:ships.id')).toBe(false);
  });
});
