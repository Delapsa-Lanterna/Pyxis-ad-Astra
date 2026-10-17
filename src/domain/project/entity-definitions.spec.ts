import { describe, expect, it } from 'vitest';
import type { EntityKind } from '@/shared/types';
import { entityContentId, entityContentIdField } from './entity-definitions';

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
