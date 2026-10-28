import type { JointHullProjection, JointValue, RowData } from '@/shared/types';
import type { ImmersiveField } from './fields';
import { getSchema } from '@/domain/schema/config-schema-registry';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { jointObject } from '@/domain/joint-edit';
type Inputs = JointHullProjection['fields'][string];
export function hullFieldValue(
  inputs: Inputs | undefined,
  data: ReadonlyMap<string, Readonly<RowData>>,
): import('@/shared/types').JsonValue | undefined {
  let value: import('@/shared/types').JsonValue | undefined;
  for (const input of inputs ?? []) {
    const source = data.get(input.recordKey)!,
      next = source[input.path];
    if (next === undefined || (input.path === 'fpMod' && source.fleetPoints !== undefined)) continue;
    value =
      input.path === 'fpMod'
        ? Number(value ?? 0) + Number(next)
        : input.path === 'baseValueMult'
          ? Math.trunc(Number(value ?? 0) * Number(next))
          : next;
  }
  return value;
}
export function hullFieldInputs(inputs: Inputs, key: string, label: string): ImmersiveField[] {
  const columns = getCsvColumnSchemas('ships');
  const skins = getSchema('skin')!.sections!.flatMap((section) => section.fields);
  return inputs.map((input, index) => {
    const base = columns.find((field) => field.key === key);
    const skin = index ? skins.find((field) => field.key === input.path)! : null;
    return {
      id: index ? 'skin/' + index + '/' + input.path : 'csv/' + key,
      recordKey: input.recordKey,
      inheritOnEmpty: Boolean(index),
      schema: skin
        ? { ...skin, required: false, label: skin.label + ' · 皮肤值（空白继承）' }
        : {
            key: input.path,
            label: inputs.length > 1 ? label + ' · 基础值' : label,
            type: base?.control === 'number' ? 'float' : base?.source ? 'enum' : 'string',
            source: base?.source,
          },
    };
  });
}
export function hullDataIndex(records: readonly import('@/shared/types').JointEditRecord[], values: Record<string, JointValue>) {
  return new Map(records.map((record) => [record.key, jointObject(values[record.key] ?? record.value)]));
}
