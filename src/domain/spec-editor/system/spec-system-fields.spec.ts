import { describe, expect, it } from 'vitest';
import { SYSTEM_TYPES } from '@/domain/editors/lib/game-spec-enums';
import { createSystemSpec } from '@/domain/entity-write/spec-construction';
import { systemSpecIssues } from './spec-system-fields';

describe('system field registries', () => {
  it.each(SYSTEM_TYPES)('accepts registered system type %s through save validation', (type) => {
    expect(systemSpecIssues({ ...createSystemSpec('sample'), type })).toEqual([]);
  });
});
