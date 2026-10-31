import type { AssociatedSpecCreateParams, RowData, CsvTableKey } from '@/shared/types';
import { cell } from '@/shared/lib/starsector';

import { inferWeaponSpecClass } from '@/domain/editors/weapon-spec';

export function associatedSpecCreateParams(table: CsvTableKey, id: string, row: RowData): AssociatedSpecCreateParams {
  switch (table) {
    case 'ships': {
      const name = cell(row.name);
      return { kind: 'ship', id, hullName: name.trim() ? name : id };
    }
    case 'weapons':
      return { kind: 'weapon', id, specClass: inferWeaponSpecClass(row) };
    case 'shipSystems':
      return { kind: 'system', id };
    case 'skills':
      return { kind: 'skill', id };
    default:
      throw new Error(`CSV table has no associated spec: ${table}`);
  }
}
