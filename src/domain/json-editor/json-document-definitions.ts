import type {
  CsvRow,
  DeepReadonly,
  EntityData,
  EntityEditTarget,
  FileVersion,
  JsonEditorPageId,
  JsonRecoveryPlan,
  JsonValue,
  ResourceRef,
  RowData,
  JsonDocumentOrigin,
  JsonComposition,
} from '@/shared/types';
import type { JsonFileContent } from '@/shared/types';
import { entityContentIdField } from '@/domain/project/entity-definitions';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { aggregateSchemaSources } from '@/domain/schema/schema-sources';
import { schemaDocumentIssues } from '@/domain/schema/schema-validation';
import type { FileSchema } from '@/domain/schema/schema.types';
import { configFactionListItems } from './json-config-entities';
import { variantFileDefinition, skinFileDefinition, jsonFileTitle, type JsonFileDefinition } from './json-file-definitions';
import { projectJsonValue } from '@/domain/json-document';
import { miscConfigDefinition } from '@/domain/misc-config';
import { composeJson } from '@/domain/json-composition';
import { requireRowData } from '@/shared/lib/row-data';

export type JsonDocumentKind = 'mod-info' | 'faction' | 'mission' | 'variant' | 'skin' | 'misc-config';
export interface ConfigDocumentTarget {
  sessionId: string;
  modRoot: string;
  kind: JsonDocumentKind;
  id: string;
  entity: EntityEditTarget | null;
}
export interface JsonDocumentRecord {
  target: ConfigDocumentTarget;
  value: RowData;
  document: JsonFileContent | null;
  baseVersions: FileVersion[];
  resources: Record<string, ResourceRef>;
  composition?: JsonComposition;
}
export interface JsonDocumentDefinition {
  kind: JsonDocumentKind;
  label: string;
  directory: string;
  idField: string;
  icon: string;
  file?: JsonFileDefinition;
}
export const JSON_DOCUMENT_DEFINITIONS: Record<JsonEditorPageId, JsonDocumentDefinition> = {
  'mod-info': { kind: 'mod-info', label: 'Mod 信息', directory: 'mod_info.json', idField: 'id', icon: '' },
  'misc-config': {
    kind: 'misc-config',
    label: '杂项配置',
    directory: 'data',
    idField: '',
    icon: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
  },
  factions: {
    kind: 'faction',
    label: '势力',
    directory: 'data/world/factions',
    idField: entityContentIdField('faction'),
    icon: 'M12 3 4 7v6l8 8 8-8V7z',
  },
  mission: {
    kind: 'mission',
    label: '战役',
    directory: 'data/missions',
    idField: 'mission',
    icon: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
  },
  variants: {
    kind: 'variant',
    label: '装配',
    directory: 'data/variants',
    idField: entityContentIdField('variant'),
    icon: variantFileDefinition.listIconPaths[0]!,
    file: variantFileDefinition,
  },
  skins: {
    kind: 'skin',
    label: '舰船皮肤',
    directory: 'data/hulls/skins',
    idField: entityContentIdField('skin'),
    icon: skinFileDefinition.listIconPaths[0]!,
    file: skinFileDefinition,
  },
};
export function configDocumentKey(target: ConfigDocumentTarget): string {
  return JSON.stringify([target.sessionId, target.modRoot, target.kind, target.id, target.entity?.write.relPath ?? null]);
}
export function jsonDocumentOrigin(target: ConfigDocumentTarget): JsonDocumentOrigin {
  switch (target.kind) {
    case 'mod-info':
      return { kind: 'modInfo' };
    case 'misc-config':
      return { kind: 'miscConfig', file: miscConfigDefinition(target.id).kind };
    default:
      return { kind: 'entity', target: { kind: target.kind, id: target.id, relPath: target.entity!.write.relPath } };
  }
}
export function jsonDocumentValue(kind: JsonDocumentKind, value: RowData): RowData {
  if (kind === 'variant' || kind === 'skin') return value;
  return aggregateSchemaSources(kind === 'mission' ? value : { file: value });
}
export function jsonDocumentRecord(sessionId: string, modRoot: string, record: DeepReadonly<EntityData>): JsonDocumentRecord {
  const entity = cloneQuerySnapshot<EntityData>(record),
    kind = entity.kind as JsonDocumentKind;
  const raw =
    entity.document && kind !== 'mission'
      ? requireRowData(projectJsonValue(entity.document.content), 'JSON 文件根对象无效')
      : requireRowData(entity.data, 'JSON 文档内容无效');
  return {
    target: { sessionId, modRoot, kind, id: entity.id, entity: entity.target },
    value: jsonDocumentValue(kind, raw),
    document: entity.document,
    baseVersions: entity.baseVersions,
    resources: entity.resourceRefs,
    composition: entity.composition ?? undefined,
  };
}
export function jsonDocumentContent(kind: JsonDocumentKind, value: RowData): RowData {
  return kind === 'variant' || kind === 'skin' ? value : (value[kind === 'mission' ? 'descriptor' : 'file'] as RowData);
}
export function jsonDocumentId(definition: JsonDocumentDefinition, value: RowData): string {
  const data = definition.kind === 'mission' ? (value.list as RowData) : jsonDocumentContent(definition.kind, value);
  return String(data[definition.idField] ?? '').trim();
}
export function jsonDocumentPartial(definition: JsonDocumentDefinition, value: RowData, composition?: JsonComposition): boolean {
  return definition.kind === 'misc-config' || Boolean(composition && definition.kind !== 'variant' && !jsonDocumentId(definition, value));
}
export function jsonDocumentIssues(definition: JsonDocumentDefinition, schema: FileSchema, value: RowData, composition?: JsonComposition) {
  const kind = definition.kind,
    key = kind === 'mission' ? 'descriptor' : ['faction', 'mod-info', 'misc-config'].includes(kind) ? 'file' : null;
  const effective = key
    ? { ...value, [key]: composeJson(value[key] as RowData, kind === 'misc-config' ? undefined : composition) }
    : composeJson(value, composition);
  return schemaDocumentIssues(schema, effective, jsonDocumentPartial(definition, value, composition));
}
export function jsonRecoveryValue(target: ConfigDocumentTarget, plan: JsonRecoveryPlan, current: RowData): RowData {
  if (target.kind === 'mission') {
    const index = plan.currentSources.index as unknown as { rows: CsvRow[] };
    const list = index.rows.find((row) => !row.isComment && row.data.mission === target.id)!.data;
    return {
      ...current,
      ...aggregateSchemaSources({
        list,
        descriptor: plan.documents.descriptor ? projectJsonValue(plan.documents.descriptor.content) : plan.currentSources.descriptor,
        text: plan.currentSources.text ?? '',
      }),
    };
  }
  const value = plan.documents.file ? projectJsonValue(plan.documents.file.content) : plan.currentSources.file!;
  return target.kind === 'misc-config'
    ? miscConfigDocumentValue(value)
    : jsonDocumentValue(target.kind, requireRowData(value, 'JSON 文件根对象无效'));
}
export function jsonDocumentSummary(
  definition: JsonDocumentDefinition,
  record: JsonDocumentRecord,
  draft = record.value,
  hullNames: Record<string, string> = {},
) {
  const kind = definition.kind,
    local = kind === 'mission' ? ((draft.descriptor ?? draft.list) as RowData) : jsonDocumentContent(kind, draft);
  const data = composeJson(local, record.composition),
    id = kind === 'misc-config' ? record.target.id : jsonDocumentId(definition, draft) || record.target.id;
  const title =
    kind === 'misc-config'
      ? miscConfigDefinition(id).label
      : definition.file
        ? jsonFileTitle(definition.file, { id, data }, hullNames)
        : String(data[kind === 'mission' ? 'title' : kind === 'mod-info' ? 'name' : 'displayName'] || id || definition.label);
  return {
    id,
    title,
    color: kind === 'faction' ? configFactionListItems({ [record.target.id]: data })[0]!.colorCss : '',
    companion: definition.file ? String(data[definition.file.companionField] ?? '') : '',
  };
}
export function jsonDocumentMedia(record: JsonDocumentRecord) {
  return record.target.kind === 'mission'
    ? (record.resources.icon ?? null)
    : (record.resources.sprite ?? record.resources.crest ?? record.resources.logo ?? null);
}
export function miscConfigDocumentValue(value: JsonValue): RowData {
  return { file: value };
}
export function miscConfigDocumentContent(value: RowData): JsonValue {
  return value.file!;
}
