import type { JsonValue } from '@/shared/types';
import type { SaveEdit } from '@/shared/types';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { deepClone } from '@/shared/lib/starsector';

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

export function retainLaterDraft<T>(current: T, submitted: T, saved: T): T {
  if (stableDeepEqual(current, submitted)) return deepClone(saved);
  if (
    current &&
    submitted &&
    saved &&
    typeof current === 'object' &&
    typeof submitted === 'object' &&
    typeof saved === 'object' &&
    !Array.isArray(current) &&
    !Array.isArray(submitted) &&
    !Array.isArray(saved)
  ) {
    const live = current as Record<string, unknown>,
      captured = submitted as Record<string, unknown>;
    const result = deepClone(saved) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(live), ...Object.keys(captured)])) {
      if (!Object.hasOwn(live, key)) delete result[key];
      else if (!Object.hasOwn(captured, key)) result[key] = deepClone(live[key]);
      else result[key] = retainLaterDraft(live[key], captured[key], result[key]);
    }
    return result as T;
  }
  return deepClone(current);
}
