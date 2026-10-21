import { describe, expect, it } from 'vitest';
import type { ResourceRef } from '@/shared/types';
import { entityTargetFixture } from '@/test/entity-target';
import { jsonDocumentMedia, jsonDocumentRecord } from './json-document-definitions';

const logo: ResourceRef = { source: 'mod', ownerKind: 'faction', ownerId: 'sample', relPath: 'graphics/logo.png', key: 'logo' };
const crest: ResourceRef = { ...logo, relPath: 'graphics/crest.png', key: 'crest' };

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
