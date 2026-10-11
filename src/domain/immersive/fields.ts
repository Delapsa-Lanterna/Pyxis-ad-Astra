import type { DeepReadonly, JointEditRecord, JointValue, JsonValue } from '@/shared/types';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import { applySchemaFieldUpdate, getNestedValue, schemaStringValue } from '@/domain/schema/schema-values';
import { entityContentIdField } from '@/domain/editors/entity-identity';
import { jointObject } from '@/domain/joint-edit';
import type { BitmapTextRun, ImmersiveFontRole } from './bitmap-font';

export interface ImmersiveField {
  id: string;
  recordKey: string;
  schema: FieldSchema;
  optionLabels?: Record<string, string>;
}
export interface ImmersiveFieldChange {
  field: ImmersiveField;
  update: SchemaFieldUpdate;
}
export interface ImmersiveStat {
  id: string;
  label: string;
  display: string;
  fields: ImmersiveField[];
  formula?: string;
  tone?: 'normal' | 'highlight' | 'crew' | 'fuel';
  displayRuns?: BitmapTextRun[];
  font?: ImmersiveFontRole;
  inline?: boolean;
  gapBefore?: boolean;
  diagnostic?: string;
}

export function immersiveFieldValue(values: DeepReadonly<Record<string, JointValue>>, field: ImmersiveField): unknown {
  return getNestedValue(jointObject(values[field.recordKey]), field.schema.key);
}

export function updateImmersiveField(
  values: Record<string, JointValue>,
  record: JointEditRecord,
  field: ImmersiveField,
  update: SchemaFieldUpdate,
): Record<string, JointValue> {
  let data = jointObject(values[record.key]);
  if (values[record.key]?.state === 'missing') {
    data =
      record.target.kind === 'csv'
        ? { ...record.target.identity }
        : record.target.kind === 'spec'
          ? { [entityContentIdField(record.target.target.kind)]: record.target.target.id }
          : {};
  }
  const converted: SchemaFieldUpdate =
    record.target.kind === 'csv' ? { kind: 'set', value: update.kind === 'set' ? schemaStringValue(update.value) : '' } : update;
  return {
    ...values,
    [record.key]: { state: 'present', value: applySchemaFieldUpdate(data, field.schema.key, converted) as Record<string, JsonValue> },
  };
}
