import type {
  DeepReadonly,
  JointEditRecord,
  JointEditSnapshot,
  JointEditKind,
  JointValue,
  JsonValue,
  ResourceRef,
  RowData,
} from '@/shared/types';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import { applySchemaFieldUpdate, getNestedValue, schemaStringValue } from '@/domain/schema/schema-values';
import { entityContentIdField } from '@/domain/editors/entity-identity';
import { jointObject } from '@/domain/joint-edit';
import type { TextRun } from '@/domain/fonts/font.types';
import type { ImmersiveFontRole } from './font-roles';
import { parseInputNumber } from '@/shared/lib/input-number';
import { createDefaultVariant, createDefaultSkin } from '@/domain/config/config-entities';
import { variantModuleEntries, setVariantModule } from '@/domain/config/config-entities';

export interface ImmersivePanelState {
  kind: JointEditKind;
  allStats: ImmersiveStat[];
}
export interface ImmersiveEditorDefinition<TPanel extends ImmersivePanelState = ImmersivePanelState> {
  label: string;
  editableRecords: (snapshot: JointEditSnapshot) => string[];
  project: (snapshot: JointEditSnapshot, values: Record<string, JointValue>, projection: JointEditSnapshot | null) => TPanel;
  references: (snapshot: JointEditSnapshot, values: Record<string, JointValue>) => unknown[];
  media: (panel: TPanel) => ResourceRef[];
  retainDisplayReferences: boolean;
  updateField?: typeof updateImmersiveField;
}

export interface ImmersiveField {
  id: string;
  recordKey: string;
  schema: FieldSchema;
  optionLabels?: Record<string, string>;
  handoff?: boolean;
  moduleSlot?: string;
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
  displayRuns?: TextRun[];
  font?: ImmersiveFontRole;
  inline?: boolean;
  gapBefore?: boolean;
  diagnostic?: string;
}

export function immersiveFieldValue(values: DeepReadonly<Record<string, JointValue>>, field: ImmersiveField): unknown {
  if (field.moduleSlot)
    return variantModuleEntries(jointObject(values[field.recordKey]).modules).find(([slot]) => slot === field.moduleSlot)?.[1] ?? '';
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
          ? record.target.target.kind === 'variant'
            ? createDefaultVariant('', record.target.target.id)
            : record.target.target.kind === 'skin'
              ? createDefaultSkin('', record.target.target.id)
              : { [entityContentIdField(record.target.target.kind)]: record.target.target.id }
          : {};
  }
  const converted: SchemaFieldUpdate =
    record.target.kind === 'csv' ? { kind: 'set', value: update.kind === 'set' ? schemaStringValue(update.value) : '' } : update;
  if (field.moduleSlot)
    return {
      ...values,
      [record.key]: {
        state: 'present',
        value: setVariantModule(data, field.moduleSlot, update.kind === 'set' ? schemaStringValue(update.value) : ''),
      },
    };
  return {
    ...values,
    [record.key]: { state: 'present', value: applySchemaFieldUpdate(data, field.schema.key, converted) as Record<string, JsonValue> },
  };
}

export function immersiveNumber(csv: Readonly<RowData>, key: string, fallback: number): number {
  const raw = schemaStringValue(csv[key]);
  if (!raw.trim()) return fallback;
  const value = parseInputNumber(raw, false);
  return typeof value === 'number' ? value : NaN;
}
