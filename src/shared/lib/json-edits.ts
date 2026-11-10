import type { JsonValue } from '@/shared/types';
import { stableDeepEqual } from './stable-compare';
export type JsonValueEdit = { kind: 'set'; path: string[]; value: JsonValue } | { kind: 'remove'; path: string[] };

/** Compares business JSON; arrays are one value because their identities belong to the editing document. */
export function captureJsonEdits(before: JsonValue, after: JsonValue): JsonValueEdit[] {
  const edits: JsonValueEdit[] = [];
  function visit(before: JsonValue | undefined, after: JsonValue | undefined, path: string[]) {
    if (before === after || stableDeepEqual(before, after, true)) return;
    if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) visit(before[key], after[key], [...path, key]);
    } else if (after === undefined) edits.push({ kind: 'remove', path });
    else edits.push({ kind: 'set', path, value: after });
  }
  visit(before, after, []);
  return edits;
}
