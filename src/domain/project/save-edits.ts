import type { JsonValue } from '@/shared/types';
import type { SaveEdit } from '@/shared/types';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

// Objects retain field ownership; arrays and text are single business values.
export function captureSaveEdits(before: JsonValue, after: JsonValue, path: string[] = []): SaveEdit[] {
  if (stableDeepEqual(before, after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => {
      const target = [...path, key];
      if (!Object.hasOwn(after, key)) return [{ path: target, kind: 'remove' } as SaveEdit];
      if (!Object.hasOwn(before, key)) return [{ path: target, kind: 'set', value: after[key]! } as SaveEdit];
      return captureSaveEdits(before[key]!, after[key]!, target);
    });
  }
  return [{ path, kind: 'set', value: after }];
}
