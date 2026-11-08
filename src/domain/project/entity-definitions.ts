import { AppError } from '@/shared/lib/errors';
import type { EntityKind, RowData } from '@/shared/types';

export function entityContentId(kind: EntityKind, content: RowData): string {
  const field = entityContentIdField(kind);
  const id = content[field];
  if (typeof id !== 'string') throw new AppError(`${field} 必须是字符串`, { action: 'prepare-entity-identity' });
  return id;
}

export function entityContentIdField(kind: EntityKind): string {
  return kind === 'ship' ? 'hullId' : kind === 'variant' ? 'variantId' : kind === 'skin' ? 'skinHullId' : 'id';
}

export function hasEntityIdConflict<T>(entities: T[], nextId: string, currentId: string | null, entityId: (entity: T) => string): boolean {
  return entities.some((entity) => {
    const id = entityId(entity);
    return id === nextId && id !== currentId;
  });
}

export function entityRenameContext(currentId: string, nextId: string): { previousId: string | null } {
  return { previousId: nextId !== currentId ? currentId : null };
}

export function trimmedEntityStringField(data: RowData, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value.trim() : '';
}
