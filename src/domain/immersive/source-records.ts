import type { JointEditSnapshot, JointEditRecord } from '@/shared/types';

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
  return Object.values(immersiveSourceRecords(snapshot)).map((record) => record.key);
}
