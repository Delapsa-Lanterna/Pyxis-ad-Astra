import type {
  DeepReadonly,
  JointEditRecord,
  JointEditSnapshot,
  JointEditKind,
  JointValue,
  JsonValue,
  ResourceRef,
  RowData,
  CsvTableKey,
} from '@/shared/types';
import type { CsvColumnSchema, FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { parseCsvValue } from '@/domain/schema/csv-value-validation';
import { applySchemaFieldUpdate, getNestedValue, schemaStringValue } from '@/domain/schema/schema-values';
import { entityContentIdField } from '@/domain/project/entity-definitions';
import { jointObject } from '@/domain/joint-edit';
import type { TextRun } from '@/domain/fonts/font.types';
import type { ImmersiveFontRole } from './font-roles';
import { parseInputNumber } from '@/shared/lib/input-number';
import { createDefaultVariant, createDefaultSkin } from '@/domain/entity-write/spec-construction';
import { setVariantModule, variantModuleEntries } from '@/shared/lib/starsector/variant-modules';
import { composeJson, editComposedJson } from '@/domain/json-composition';
import { AppError } from '@/shared/lib/errors';

export interface ImmersivePanel {
  kind: JointEditKind;
  allStats: ImmersiveStat[];
}
export interface ImmersiveEditorDefinition<TPanel extends ImmersivePanel = ImmersivePanel> {
  label: string;
  editableRecords: (snapshot: JointEditSnapshot) => string[];
  project: (snapshot: JointEditSnapshot, values: Record<string, JointValue>, preview: JointEditSnapshot | null) => TPanel;
  previewInputs: (snapshot: JointEditSnapshot, values: Record<string, JointValue>) => JsonValue;
  displayResources: (panel: TPanel) => ResourceRef[];
  retainPreviewContent: boolean;
  updateField?: typeof updateImmersiveField;
}

export interface ImmersiveField {
  id: string;
  recordKey: string;
  schema: FieldSchema;
  column?: CsvColumnSchema;
  optionLabels?: Record<string, string>;
  inheritOnEmpty?: boolean;
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
  if (!record.composition)
    return {
      ...values,
      [record.key]: { state: 'present', value: applySchemaFieldUpdate(data, field.schema.key, converted) as Record<string, JsonValue> },
    };
  // Composed records edit the effective value; only the local difference enters the draft.
  const before = composeJson(data as RowData, record.composition);
  const edit = editComposedJson(data as RowData, before, applySchemaFieldUpdate(before, field.schema.key, converted), record.composition);
  if (edit.rejected) throw new AppError(edit.notice!, { action: 'update-immersive-field', code: 'json.replace_unsupported' });
  return { ...values, [record.key]: { state: 'present', value: edit.value } };
}

export function immersiveNumber(csv: Readonly<RowData>, key: string, fallback: number, table?: CsvTableKey): number {
  const raw = schemaStringValue(csv[key]);
  if (!raw.trim()) return fallback;
  const column = table && getCsvColumnSchemas(table).find((column) => column.key === key);
  if (column) {
    const parsed = parseCsvValue(column, raw);
    return parsed.kind === 'value' && typeof parsed.value === 'number' ? parsed.value : NaN;
  }
  const value = parseInputNumber(raw.replace(/[fFdD]$/, ''), false);
  return typeof value === 'number' ? value : NaN;
}
