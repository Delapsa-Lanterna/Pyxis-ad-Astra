import { describe, expect, it } from 'vitest';
import type { ResourceRef } from '@/shared/types';
import { entityTargetFixture } from '@/test/entity-target';
import { JSON_DOCUMENT_DEFINITIONS, jsonDocumentMedia, jsonDocumentRecord, jsonDocumentSummary } from './json-document-definitions';

const logo: ResourceRef = { source: 'mod', ownerKind: 'faction', ownerId: 'sample', relPath: 'graphics/logo.png', key: 'logo' };
const crest: ResourceRef = { ...logo, relPath: 'graphics/crest.png', key: 'crest' };

it('summarizes indexed missions before loading their document and uses the edited title after loading', () => {
  const record = jsonDocumentRecord('s1', 'M:/one', {
    kind: 'mission',
    id: 'sample',
    target: entityTargetFixture('mission', 'sample'),
    baseVersions: [],
    resourceRefs: {},
    data: { list: { mission: 'sample' } },
  });
  expect(jsonDocumentSummary(JSON_DOCUMENT_DEFINITIONS.mission, record)).toMatchObject({ id: 'sample', title: 'sample' });
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
        id: 'sample',
        target: entityTargetFixture('faction', 'sample'),
        baseVersions: [],
        data: { id: 'sample', color: [85, 190, 220, 255] },
        resourceRefs,
      });
      expect(jsonDocumentMedia(record)).toEqual(expected);
      expect((record.value.file as import('@/shared/types').RowData).color).toEqual([85, 190, 220, 255]);
    },
  );
});
