import { isRowData } from '@/shared/lib/row-data';
import type { JsonValue, RowData } from '@/shared/types';

export function variantModuleEntries(value: JsonValue | undefined): Array<[string, string]> {
  const objects = Array.isArray(value) ? value.filter(isRowData) : isRowData(value) ? [value] : [];
  return objects.flatMap((item) =>
    Object.entries(item).flatMap(([slot, id]) => (typeof id === 'string' ? [[slot, id] as [string, string]] : [])),
  );
}

export function setVariantModule(data: Readonly<RowData>, slotId: string, id: string): RowData {
  const entries = variantModuleEntries(data.modules);
  const index = entries.findIndex(([slot]) => slot === slotId);
  if (index >= 0) {
    if (id) entries[index] = [slotId, id];
    else entries.splice(index, 1);
  } else if (id) entries.push([slotId, id]);
  return {
    ...data,
    modules: Array.isArray(data.modules) ? entries.map(([slot, target]) => ({ [slot]: target })) : Object.fromEntries(entries),
  };
}

export function renameVariantModules(data: Readonly<RowData>, previous: string, next: string): RowData {
  let result = { ...data };
  for (const [slot, id] of variantModuleEntries(data.modules)) if (id === previous) result = setVariantModule(result, slot, next);
  return result;
}
