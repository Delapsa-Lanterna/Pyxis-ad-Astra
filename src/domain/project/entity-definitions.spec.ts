import { describe, expect, it } from 'vitest';
import type { EntityKind } from '@/shared/types';
import {
  entityContentId,
  entityContentIdField,
  entityIdInvalidMessage,
  entityRenameContext,
  hasEntityIdConflict,
  isEntityId,
  trimmedEntityStringField,
} from './entity-definitions';

const fields: Array<[EntityKind, string]> = [
  ['ship', 'hullId'],
  ['weapon', 'id'],
  ['projectile', 'id'],
  ['system', 'id'],
  ['skill', 'id'],
  ['faction', 'id'],
  ['mission', 'id'],
  ['variant', 'variantId'],
  ['skin', 'skinHullId'],
];

describe('entity content identity', () => {
  it.each(fields)('reads %s identity from %s without transforming its value', (kind, field) => {
    expect(entityContentIdField(kind)).toBe(field);
    expect(entityContentId(kind, { [field]: ' Mixed_ID ', other: 'unrelated' })).toBe(' Mixed_ID ');
    expect(entityContentId(kind, { [field]: '' })).toBe('');
  });

  it.each(fields)('preserves the missing or invalid %s identity diagnostic', (kind, field) => {
    for (const content of [{}, { [field]: null }, { [field]: 7 }]) {
      expect(() => entityContentId(kind, content)).toThrowError(
        expect.objectContaining({ name: 'AppError', message: `${field} 必须是字符串`, action: 'prepare-entity-identity' }),
      );
    }
  });
});

describe('entity list identity', () => {
  it('accepts portable identifiers and reports invalid values', () => {
    expect(isEntityId(' Demo_01.alpha-2 ')).toBe(true);
    expect(isEntityId('')).toBe(false);
    expect(isEntityId('_demo')).toBe(false);
    expect(entityIdInvalidMessage('variant ID', '坏值')).toContain('variant ID "坏值"');
  });

  it('distinguishes an unchanged target from an occupied rename target', () => {
    const files = [{ id: 'one' }, { id: 'two' }];
    expect(hasEntityIdConflict(files, 'one', 'one', (file) => file.id)).toBe(false);
    expect(hasEntityIdConflict(files, 'two', 'one', (file) => file.id)).toBe(true);
    expect(entityRenameContext('one', 'one')).toEqual({ previousId: null });
    expect(entityRenameContext('one', 'two')).toEqual({ previousId: 'one' });
  });

  it('trims string fields while leaving non-string values empty', () => {
    expect(trimmedEntityStringField({ id: ' demo ' }, 'id')).toBe('demo');
    expect(trimmedEntityStringField({ id: 3 }, 'id')).toBe('');
  });
});
