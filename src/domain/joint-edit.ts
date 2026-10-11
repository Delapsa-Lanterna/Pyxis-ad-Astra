import type { EditWriteTarget, JointEditSnapshot, JointEditPrepared, JointConflictChoice, JointValue, JsonValue } from '@/shared/types';
import { normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { deepClone } from '@/shared/lib/starsector';
import { formatJsonInput } from '@/shared/lib/json-input';

export function conflictValueText(value: JointValue): string {
  return value.state === 'missing' ? '字段不存在' : value.value === null ? 'null' : formatJsonInput(value.value, 'json');
}

export function jointWriteTargets(snapshot: JointEditSnapshot): EditWriteTarget[] {
  const paths = new Set(snapshot.baseVersions.map((version) => version.path));
  for (const record of snapshot.records)
    paths.add(record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path);
  return [...paths].map((path) => ({ sessionId: snapshot.root.sessionId, modRoot: snapshot.root.modRoot, path }));
}

export function editTargetsOverlap(left: EditWriteTarget, right: EditWriteTarget): boolean {
  return (
    left.sessionId === right.sessionId &&
    normalizeFsPath(left.modRoot) === normalizeFsPath(right.modRoot) &&
    (pathBelongsToRoot(left.path, right.path) || pathBelongsToRoot(right.path, left.path))
  );
}

export function applyJointConflictChoices(prepared: JointEditPrepared, choices: JointConflictChoice[]): Record<string, JointValue> {
  const values = deepClone(prepared.values);
  const byField = new Map(choices.map((choice) => [JSON.stringify([choice.recordKey, choice.path]), choice]));
  for (const conflict of prepared.conflicts) {
    const choice = byField.get(JSON.stringify([conflict.recordKey, conflict.path]))!;
    const selected = choice.choice === 'draft' ? conflict.draft : conflict.disk;
    if (conflict.path.length === 0) {
      values[conflict.recordKey] = deepClone(selected);
      continue;
    }
    const record = values[conflict.recordKey]!;
    if (record.state === 'present') {
      let object = record.value as Record<string, JsonValue>;
      for (const key of conflict.path.slice(0, -1)) object = object[key] as Record<string, JsonValue>;
      const key = conflict.path.at(-1)!;
      if (selected.state === 'missing') delete object[key];
      else Object.defineProperty(object, key, { value: deepClone(selected.value), enumerable: true, writable: true, configurable: true });
    }
  }
  return values;
}
