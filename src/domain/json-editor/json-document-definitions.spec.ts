import { describe, expect, it } from 'vitest';
import type { ResourceRef, RowData, JsonComposition } from '@/shared/types';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import {
  JSON_DOCUMENT_DEFINITIONS,
  jsonDocumentMedia,
  jsonDocumentRecord,
  jsonDocumentSummary,
  jsonDocumentIssues,
  jsonDocumentPartial,
} from './json-document-definitions';
import { getSchema } from '@/domain/schema/config-schema-registry';
import { createDefaultFaction } from './json-config-entities';

const logo: ResourceRef = { source: 'mod', ownerKind: 'faction', ownerId: 'sample', relPath: 'graphics/logo.png', key: 'logo' };
const crest: ResourceRef = { ...logo, relPath: 'graphics/crest.png', key: 'crest' };

it('summarizes indexed missions before loading their document and uses the edited title after loading', () => {
  const record = jsonDocumentRecord('s1', 'M:/one', {
    kind: 'mission',
    document: null,
    composition: null,
    id: 'sample',
    target: entityTargetFixture('mission', 'sample'),
    baseVersions: [],
    resourceRefs: {},
    data: { list: { mission: 'sample' } },
  });
  expect(jsonDocumentSummary(JSON_DOCUMENT_DEFINITIONS.mission, record)).toMatchObject({ id: 'sample', title: 'sample' });
  expect(jsonDocumentMedia(record)).toBeNull();
  const icon: ResourceRef = {
    source: 'core',
    ownerKind: 'mission',
    ownerId: 'sample',
    relPath: 'data/missions/sample/icon.jpg',
    key: 'icon',
  };
  record.resources.icon = icon;
  expect(jsonDocumentMedia(record)).toEqual(icon);
  expect(
    jsonDocumentSummary(JSON_DOCUMENT_DEFINITIONS.mission, record, { ...record.value, descriptor: { title: 'Edited title' } }),
  ).toMatchObject({ id: 'sample', title: 'Edited title' });
});

describe('faction list icon', () => {
  it.each([
    [{ crest, logo }, crest],
    [{ crest }, crest],
    [{ logo }, logo],
    [{}, null],
  ] satisfies Array<[Record<string, ResourceRef>, ResourceRef | null]>)(
    'selects crest, then logo, then the color fallback',
    (resourceRefs, expected) => {
      const record = jsonDocumentRecord('s1', 'M:/one', {
        kind: 'faction',
        document: null,
        composition: null,
        id: 'sample',
        target: entityTargetFixture('faction', 'sample'),
        baseVersions: [],
        data: { id: 'sample', color: [85, 190, 220, 255] },
        resourceRefs,
      });
      expect(jsonDocumentMedia(record)).toEqual(expected);
      expect((record.value.file as RowData).color).toEqual([85, 190, 220, 255]);
    },
  );
});

describe('complete and composed deletion validation', () => {
  function sources(data: RowData, replace = false): JsonComposition {
    return {
      layers: [
        {
          source: { source: 'core', root: 'M:/base', path: 'M:/base/source.json', relPath: 'source.json' },
          version: { path: 'M:/base/source.json', fingerprint: 'base' },
          data,
          replace: false,
        },
      ],
      excluded: [],
      replace,
    };
  }
  it.each([false, true])('validates a sparse fallback after composition with local identity=%s', (identity) => {
    const base = { ...createDefaultFaction('base_faction'), shipRoles: { role: { fallback: { target: 1 } } } };
    const value = { file: { ...(identity ? { id: 'base_faction' } : {}), shipRoles: { role: { fallback: {} } } } };
    const composition = sources(base);
    expect(jsonDocumentPartial(JSON_DOCUMENT_DEFINITIONS.factions, value, composition)).toBe(!identity);
    expect(jsonDocumentIssues(JSON_DOCUMENT_DEFINITIONS.factions, getSchema('faction')!, value, composition)).toEqual([]);
    expect(
      jsonDocumentIssues(JSON_DOCUMENT_DEFINITIONS.factions, getSchema('faction')!, value, { ...composition, layers: [] }).length,
    ).toBeGreaterThan(0);
  });
  it('validates misc supplements against inherited content and enforces replacement completeness', () => {
    const definition = JSON_DOCUMENT_DEFINITIONS['misc-config'],
      schema = getSchema('sounds')!;
    const composition = sources({ music: { inherited: [{ source: 'sounds/music', file: 'base.ogg' }] } });
    expect(jsonDocumentIssues(definition, schema, { file: { music: {} } }, composition)).toEqual([]);
    expect(jsonDocumentIssues(definition, schema, { file: {} }, { ...composition, replace: true })).toHaveLength(1);
    expect(jsonDocumentIssues(definition, schema, { file: {} }, { layers: [], excluded: [], replace: false })).toEqual([]);
    expect(jsonDocumentIssues(definition, schema, { file: { sample: [{}] } }, composition)).toHaveLength(1);
  });
});
