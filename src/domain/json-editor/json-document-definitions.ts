import { entityContentIdField } from '@/domain/project/entity-definitions';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import type { DeepReadonly, EntityData, EntityEditTarget, FileVersion, JsonEditorPageId, ResourceRef, RowData } from '@/shared/types';
import { aggregateSchemaSources } from '@/domain/schema/schema-sources';
import { configFactionListItems } from './json-config-entities';
import { variantFileDefinition, skinFileDefinition, jsonFileTitle, type JsonFileDefinition } from './json-file-definitions';
import { requireRowData } from '@/shared/lib/row-data';

export type JsonDocumentKind = 'mod-info' | 'faction' | 'mission' | 'variant' | 'skin';
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
  baseVersions: FileVersion[];
  resources: Record<string, ResourceRef>;
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
export function configDocumentKey(target: ConfigDocumentTarget) {
  return JSON.stringify({
    sessionId: target.sessionId,
    modRoot: target.modRoot,
    kind: target.kind,
    id: target.id,
    relPath: target.entity?.write.relPath ?? null,
  });
}
export function jsonDocumentValue(kind: JsonDocumentKind, data: RowData): RowData {
  return kind === 'variant' || kind === 'skin' ? data : aggregateSchemaSources(kind === 'mission' ? data : { file: data });
}
export function jsonDocumentRecord(sessionId: string, modRoot: string, record: DeepReadonly<EntityData>): JsonDocumentRecord {
  const entity = cloneQuerySnapshot<EntityData>(record);
  return {
    target: { sessionId, modRoot, kind: entity.kind as JsonDocumentKind, id: entity.id, entity: entity.target },
    value: jsonDocumentValue(entity.kind as JsonDocumentKind, requireRowData(entity.data, 'JSON 文档内容无效')),
    baseVersions: entity.baseVersions,
    resources: entity.resourceRefs,
  };
}
export function jsonDocumentContent(kind: JsonDocumentKind, value: RowData): RowData {
  return kind === 'variant' || kind === 'skin' ? value : (value[kind === 'mission' ? 'descriptor' : 'file'] as RowData);
}
export function jsonDocumentId(definition: JsonDocumentDefinition, value: RowData): string {
  const data = definition.kind === 'mission' ? (value.list as RowData) : jsonDocumentContent(definition.kind, value);
  return String(data[definition.idField] ?? '').trim();
}
export function jsonDocumentSummary(
  definition: JsonDocumentDefinition,
  record: JsonDocumentRecord,
  draft = record.value,
  hullNames: Record<string, string> = {},
) {
  const { kind } = definition;
  const data = jsonDocumentContent(kind, draft);
  const id = jsonDocumentId(definition, draft);
  const file = definition.file;
  const title = file
    ? jsonFileTitle(file, { id, data }, hullNames)
    : String(data[kind === 'mission' ? 'title' : kind === 'mod-info' ? 'name' : 'displayName'] || id || definition.label);
  return {
    id,
    title,
    color: kind === 'faction' ? configFactionListItems({ [record.target.id]: data })[0]!.colorCss : '',
    companion: file ? String(jsonDocumentContent(kind, record.value)[file.companionField] ?? '') : '',
  };
}

export function jsonDocumentMedia(record: JsonDocumentRecord) {
  return record.target.kind === 'mission' ? null : (record.resources.sprite ?? record.resources.crest ?? record.resources.logo ?? null);
}
