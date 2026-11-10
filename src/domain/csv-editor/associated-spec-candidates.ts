import type { AssociatedSpecChange, CsvTableState, CsvTableKey, AssociatedSpecPreparation } from '@/shared/types';
import { rowSpecId, MODULE_LABELS } from '@/shared/lib/starsector';
import { isCsvDeletedRow } from '@/domain/csv-editor/csv-dirty';
import { isCsvBusinessRow } from './csv-rule-context';
import { associatedSpecCreateParams } from '@/domain/csv-editor/associated-spec-creation';

export interface AssociatedSpecCandidate {
  key: string;
  table: CsvTableKey;
  label: string;
  change: AssociatedSpecChange;
  preparation?: AssociatedSpecPreparation;
  mode?: 'read' | 'overwrite';
}

export function getAssociatedSpecCandidates(state: CsvTableState, associatedSpecTables: readonly CsvTableKey[]): AssociatedSpecCandidate[] {
  if (!associatedSpecTables.includes(state.table)) return [];
  const table = state.table;
  const originalRows = new Map(Object.entries(state.baselineRows));
  const currentRows = new Map(Object.entries(state.rows));
  const candidates: AssociatedSpecCandidate[] = [];
  for (const [rowKey, dirty] of Object.entries(state.dirty)) {
    const original = originalRows.get(rowKey);
    const previousId = original && isCsvBusinessRow(original, table) ? rowSpecId(original.data, table) : '';
    if (isCsvDeletedRow(dirty)) {
      if (previousId)
        candidates.push({
          key: JSON.stringify([table, 'delete', previousId]),
          table,
          label: `删除${MODULE_LABELS[table]}规格 ${previousId}`,
          change: { action: 'delete', id: previousId },
        });
      continue;
    }
    const current = currentRows.get(rowKey)!;
    const id = isCsvBusinessRow(current, table) ? rowSpecId(current.data, table) : '';
    if (!id || previousId === id) continue;
    const create = associatedSpecCreateParams(table, id, current.data);
    const change: AssociatedSpecChange = previousId ? { action: 'rename', previousId, create } : { action: 'create', create };
    candidates.push({
      key: JSON.stringify([table, change.action, previousId, id]),
      table,
      label: previousId ? `更改规格文件名 ${previousId} 为 ${id}` : `创建${MODULE_LABELS[table]}规格 ${id}`,
      change,
    });
  }
  return candidates;
}
