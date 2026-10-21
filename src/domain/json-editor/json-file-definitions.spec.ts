import { entityTargetFixture } from '@/test/entity-target';
import { describe, expect, it } from 'vitest';
import type { JsonEntityFile } from '@/shared/types';
import { jsonFileCompanion, jsonFileTitle, skinFileDefinition, variantFileDefinition } from './json-file-definitions';

function variantFixture(overrides: Partial<JsonEntityFile> = {}): JsonEntityFile {
  return {
    baseVersions: [],
    target: entityTargetFixture('variant', 'v1'),
    id: 'v1',
    path: '',
    relPath: '',
    data: { variantId: 'v1', hullId: 'h1' },
    ...overrides,
  };
}

function skinFixture(overrides: Partial<JsonEntityFile> = {}): JsonEntityFile {
  return {
    baseVersions: [],
    target: entityTargetFixture('skin', 'sk1'),
    id: 'sk1',
    path: '',
    relPath: '',
    data: { skinHullId: 'sk1', baseHullId: 'h1' },
    ...overrides,
  };
}

describe('jsonFileTitle', () => {
  it('composes hull name and display name for variants', () => {
    const file = variantFixture({ data: { variantId: 'v1', hullId: 'h1', displayName: 'Elite' } });
    expect(jsonFileTitle(variantFileDefinition, file, { h1: 'Escort' })).toBe('Escort · Elite');
  });

  it('falls back to the hull name, then the hull id, for variants', () => {
    const file = variantFixture();
    expect(jsonFileTitle(variantFileDefinition, file, { h1: 'Escort' })).toBe('Escort');
    expect(jsonFileTitle(variantFileDefinition, file, {})).toBe('h1');
  });

  it('uses skin hullName and falls back to the draft identity', () => {
    expect(jsonFileTitle(skinFileDefinition, skinFixture({ data: { hullName: 'Local' } }), {})).toBe('Local');
    expect(jsonFileTitle(skinFileDefinition, skinFixture(), { h1: 'Escort' })).toBe('sk1');
  });
});

describe('jsonFileCompanion', () => {
  it('reads the companion field with hull id semantics per definition', () => {
    expect(jsonFileCompanion(variantFileDefinition, variantFixture())).toBe('h1');
    expect(jsonFileCompanion(skinFileDefinition, skinFixture({ data: { baseHullId: 'h9' } }))).toBe('h9');
    expect(jsonFileCompanion(skinFileDefinition, skinFixture({ data: { baseHullId: '' } }))).toBe('');
  });
});
