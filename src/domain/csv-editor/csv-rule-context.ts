import type { CsvDraftRow, CsvTableKey, CsvValidationRequest, EntityKind, ProjectInvalidation } from '@/shared/types';
import { pathBelongsToRoot } from '@/shared/lib/paths';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { cell } from '@/shared/lib/starsector';

export const CSV_SPEC_KINDS: Partial<Record<CsvTableKey, EntityKind>> = {
  ships: 'ship',
  weapons: 'weapon',
  shipSystems: 'system',
  skills: 'skill',
};
export const DESCRIPTION_KINDS: Partial<Record<string, readonly EntityKind[]>> = {
  SHIP: ['ship', 'skin'],
  WEAPON: ['weapon'],
  SHIP_SYSTEM: ['system'],
  FACTION: ['faction'],
};
export function isCsvBusinessRow(row: CsvDraftRow, identityColumn = 'id'): boolean {
  return !row.isComment && cell(row.data[identityColumn]) !== '';
}
export function hasCsvValidationInvalidation(
  invalidation: ProjectInvalidation,
  request: CsvValidationRequest,
  sourceAffected: (source: string) => boolean,
): boolean {
  if (invalidation.session || request.sources.some(sourceAffected)) return true;
  const kinds = new Set(request.entities.map((entity) => entity.kind));
  if (request.stationData.length) kinds.add('variant');
  if (kinds.has('variant')) {
    kinds.add('ship');
    kinds.add('skin');
  }
  if (kinds.has('skin')) kinds.add('ship');
  if (kinds.has('weapon')) kinds.add('projectile');
  const affects = (path: string) =>
    invalidation.resources.some(({ relPath }) => pathBelongsToRoot(path, relPath) || pathBelongsToRoot(relPath, path));
  if (request.files.some(affects)) return true;
  if (
    request.classes.length &&
    (affects('mod_info.json') ||
      request.classes.some((name) => {
        const compiled = name.replaceAll('.', '/');
        const source = compiled.split('$')[0]!;
        return [source + '.java', 'src/' + source + '.java', compiled + '.class'].some(affects);
      }) ||
      invalidation.resources.some(({ relPath }) => relPath.endsWith('.jar') || pathBelongsToRoot('jars', relPath)))
  )
    return true;
  if (kinds.has('skill') && affects('data/characters/skills')) return true;
  return (
    invalidation.entities.some((entity) => kinds.has(entity.kind)) &&
    invalidation.resources.some(({ relPath }) => !relPath.endsWith('.csv') || relPath === 'data/world/factions/factions.csv')
  );
}
export function csvValidationRequest(table: CsvTableKey, rows: readonly CsvDraftRow[]): CsvValidationRequest {
  const columns = getCsvColumnSchemas(table).filter(
    (column) => column.control === 'reference' || column.control === 'path-image' || column.script,
  );
  const entities = new Map<string, CsvValidationRequest['entities'][number]>(),
    sources = new Set<string>(),
    files = new Set<string>(),
    classes = new Set<string>(),
    stationData = new Set<string>();
  const entity = (kind: CsvValidationRequest['entities'][number]['kind'], id: string) => {
    if (id) entities.set(`${kind}:${id}`, { kind, id });
  };
  for (const row of rows) {
    if (!isCsvBusinessRow(row, table === 'simOpponents' ? 'variant id' : 'id')) continue;
    const { data } = row;
    const id = cell(data.id);
    const ownKind = CSV_SPEC_KINDS[table];
    if (ownKind) entity(ownKind, id);
    for (const column of columns) {
      const value = cell(data[column.key]);
      if (!value) continue;
      if (column.control === 'reference' && column.source && column.source !== 'csv:variants.variantId') sources.add(column.source);
      if (column.control === 'path-image') files.add(value);
      if (column.script) classes.add(value);
    }
    if (table === 'wings') entity('variant', cell(data.variant));
    if (table === 'simOpponents') {
      const value = cell(data['variant id']);
      if (value.endsWith('_wing')) sources.add('csv:wings.id');
      else entity('variant', value);
    }
    if (table === 'ships') entity('variant', cell(data['codex variant id']));
    if (table === 'descriptions') {
      for (const kind of DESCRIPTION_KINDS[cell(data.type)] ?? []) entity(kind, id);
    }
    if (table === 'industries' && cell(data.plugin) === 'com.fs.starfarer.api.impl.campaign.econ.impl.OrbitalStation') {
      stationData.add(cell(data.data));
    }
    if (table === 'specialItems' && cell(data.plugin) === 'com.fs.starfarer.api.campaign.impl.items.GenericSpecialItemPlugin')
      sources.add('csv:industries.id');
    if (table === 'specialItems' && cell(data.plugin) === 'com.fs.starfarer.api.campaign.impl.items.MultiBlueprintItemPlugin')
      for (const source of ['csv:ships.tags', 'csv:weapons.tags', 'csv:wings.tags']) sources.add(source);
  }
  return {
    entities: [...entities.values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)),
    sources: [...sources].sort(),
    files: [...files].sort(),
    classes: [...classes].sort(),
    stationData: [...stationData].sort(),
  };
}
