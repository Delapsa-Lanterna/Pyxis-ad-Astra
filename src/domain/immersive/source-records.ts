import type { JointEditSnapshot, JointEditRecord } from '@/shared/types';
import { variantModuleEntries } from '@/domain/json-editor/json-variant-modules';
import { jointObject } from '@/domain/joint-edit';

export function immersiveSourceRecords(snapshot: JointEditSnapshot): {
  spec: JointEditRecord;
  csv: JointEditRecord;
  description: JointEditRecord;
} {
  const spec = snapshot.records.find((record) => record.key === snapshot.bindings.spec)!;
  return {
    spec,
    csv: snapshot.records.find((record) => record.key === snapshot.bindings.csv)!,
    description: snapshot.records.find((record) => record.key === snapshot.bindings.description)!,
  };
}

export function immersiveEditableRecords(snapshot: JointEditSnapshot): string[] {
  if (snapshot.root.kind === 'variant') return variantEditableRecords(snapshot);
  if (snapshot.root.kind === 'wing' || snapshot.root.kind === 'skin') {
    return [
      ...new Set([
        snapshot.bindings.csv!,
        ...[
          snapshot.bindings.variant,
          snapshot.bindings.hull,
          snapshot.bindings.spec,
          snapshot.bindings.hullCsv,
          snapshot.bindings.description,
        ].filter((key): key is string => Boolean(key)),
        ...(snapshot.hull?.skinKeys ?? []),
        ...Object.values(snapshot.hull?.fields ?? {}).flatMap((inputs) => inputs.map((field) => field.recordKey)),
      ]),
    ];
  }
  return Object.values(immersiveSourceRecords(snapshot)).map((record) => record.key);
}

export function variantEditableRecords(snapshot: JointEditSnapshot): string[] {
  const root = snapshot.bindings.variant ?? snapshot.bindings.spec!;
  const keys = new Set([root]);
  const pending = [root];
  while (pending.length) {
    const key = pending.pop()!;
    const data = jointObject(snapshot.records.find((record) => record.key === key)?.value);
    for (const [, id] of variantModuleEntries(data.modules)) {
      const target = snapshot.records.find(
        (record) => record.target.kind === 'spec' && record.target.target.kind === 'variant' && record.target.target.id === id,
      );
      if (target && !keys.has(target.key)) {
        keys.add(target.key);
        pending.push(target.key);
      }
    }
  }
  return [...keys];
}
