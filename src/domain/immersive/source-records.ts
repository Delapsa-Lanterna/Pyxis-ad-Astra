import type { JointEditSnapshot, JointEditRecord } from '@/shared/types';
import { variantEditableRecords } from './variant-panel';

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
  if (snapshot.root.kind === 'wing') {
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
        ...Object.values(snapshot.hull?.fields ?? {}).map((field) => field.recordKey),
      ]),
    ];
  }
  return Object.values(immersiveSourceRecords(snapshot)).map((record) => record.key);
}
