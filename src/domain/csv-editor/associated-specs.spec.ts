import { TABLE_KEYS, SPEC_EDITOR_KINDS } from '@/shared/types';
import { describe, expect, it } from 'vitest';
import type { SpecEditorKind } from '@/shared/types';
import { associatedSpecEditorKinds, associatedSpecKind } from './associated-specs';

const TABLE_WITHOUT_SPECS = TABLE_KEYS.filter((table) => !SPEC_EDITOR_KINDS.some((kind) => kind === associatedSpecKind(table)));

describe('associatedSpecEditorKinds', () => {
  it('maps ships to the ship editor only', () => {
    expect(associatedSpecEditorKinds('ships')).toEqual(['ship']);
  });

  it('maps weapons to the weapon editor', () => {
    expect(associatedSpecEditorKinds('weapons')).toEqual(['weapon']);
  });

  it('maps ship systems to the system editor', () => {
    expect(associatedSpecEditorKinds('shipSystems')).toEqual(['system']);
  });

  it('returns no editors for tables without associated specs', () => {
    for (const table of TABLE_WITHOUT_SPECS) {
      expect(associatedSpecEditorKinds(table)).toEqual([]);
    }
  });

  it('returns copies so callers cannot mutate the definitions', () => {
    const kinds = associatedSpecEditorKinds('weapons');
    kinds.push('ship' as SpecEditorKind);
    expect(associatedSpecEditorKinds('weapons')).toEqual(['weapon']);
  });
});

describe('associatedSpecKind', () => {
  it('builds the spec rel path per table convention', () => {
    expect(associatedSpecKind('ships')).toBe('ship');
    expect(associatedSpecKind('weapons')).toBe('weapon');
    expect(associatedSpecKind('shipSystems')).toBe('system');
    expect(associatedSpecKind('skills')).toBe('skill');
  });

  it('identifies tables without specs', () => {
    expect(associatedSpecKind('wings')).toBeNull();
  });
});
