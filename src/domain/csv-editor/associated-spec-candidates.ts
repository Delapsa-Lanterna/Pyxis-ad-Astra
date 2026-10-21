import type { AssociatedSpecChange, CsvTableState, CsvTableKey } from '@/shared/types';
import { rowSpecId } from '@/shared/lib/starsector';
import { isCsvDeletedRow } from '@/domain/csv-editor/csv-dirty';
import { associatedSpecCreateParams } from '@/domain/csv-editor/associated-spec-creation';

export interface AssociatedSpecCandidate {
  key: string;
  table: CsvTableKey;
  label: string;
  change: AssociatedSpecChange;
}

export function getAssociatedSpecCandidates(state: CsvTableState, associatedSpecTables: readonly CsvTableKey[]): AssociatedSpecCandidate[] {
  if (!associatedSpecTables.includes(state.table)) return [];
  const table = state.table;
  const originalRows = new Map(Object.entries(state.baselineRows));
  const currentRows = new Map(Object.entries(state.rows));
  const candidates: AssociatedSpecCandidate[] = [];
  for (const [rowKey, dirty] of Object.entries(state.dirty)) {
    const original = originalRows.get(rowKey);
    const previousId = original && !original.isComment ? rowSpecId(original.data, table) : '';
    if (isCsvDeletedRow(dirty)) {
      if (previousId)
        candidates.push({
          key: JSON.stringify([table, 'delete', previousId]),
          table,
          label: `删除关联 spec ${previousId}`,
          change: { action: 'delete', id: previousId },
        });
      continue;
    }
    const current = currentRows.get(rowKey)!;
    const id = current.isComment ? '' : rowSpecId(current.data, table);
    if (!id || previousId === id) continue;
    const create = associatedSpecCreateParams(table, id, current.data);
    const change: AssociatedSpecChange = previousId ? { action: 'rename', previousId, create } : { action: 'create', create };
    candidates.push({
      key: JSON.stringify([table, change.action, previousId, id]),
      table,
      label: previousId ? `重命名关联 spec ${previousId} -> ${id}` : `创建关联 spec ${id}`,
      change,
    });
  }
  return candidates;
}
