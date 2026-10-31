import type * as T from '@/shared/types';
import type { WorkspaceProject } from './game-project';
import { coreRoot, gameImages, gameTablePaths } from './game-files';
import { renderGameCsv } from './game-format';
import { CONFIG_OPTION_SOURCES, isConfigSource } from '@/domain/schema/schema-sources';
import { parseCsvSource } from '@/domain/schema/csv-source-options';
import { createShipSpec, createSystemSpec, createSkillSpec } from '@/domain/entity-write/spec-construction';
import { createWeaponSpec } from '@/domain/entity-write/spec-construction';
import { miscConfigFile } from '@/domain/json-editor/misc-config-files';
const iconFields: Partial<Record<T.CsvTableKey, string>> = {
  hullmods: 'sprite',
  shipSystems: 'icon',
  industries: 'image',
  skills: 'icon',
  abilities: 'icon',
  commodities: 'icon',
  specialItems: 'icon',
  submarkets: 'icon',
  marketConditions: 'icon',
};
export const gameCommands = new Set([
  'query_csv_table_index',
  'query_csv_table_rows',
  'save_csv_patch',
  'query_hull_references',
  'query_resource_data_urls',
  'query_csv_row_preview',
  'query_csv_source_options',
  'query_image_source_options',
  'query_engine_render_assets',
  'save_misc_config',
  'delete_misc_config',
]);

export function gameCatalog(project: WorkspaceProject, kind: T.JointVariantCatalogKind): T.JointVariantEntry[] {
  const used = new Set<string>();
  return project.sources().flatMap((source) => {
    const origin =
      source.manifest.modRoot === coreRoot ? ('core' as const) : source === project ? ('mod' as const) : ('reference' as const);
    const reference = { sessionId: source.manifest.sessionId, modRoot: source.manifest.modRoot };
    const rows =
      kind === 'variants'
        ? [...source.entities.values()]
            .filter((entity) => entity.kind === 'variant')
            .map((entity) => ({ id: entity.id, data: entity.data as T.RowData }))
        : source.tables.get(kind)!.rows.map((row) => ({ id: String(row.data.id), data: row.data }));
    return rows
      .filter(({ id }) => {
        if (used.has(id)) return false;
        used.add(id);
        return true;
      })
      .map(({ id, data }) => {
        const entity = source.entities.get(source.entityKey(kind === 'weapons' ? 'weapon' : 'variant', id));
        const spec = kind === 'weapons' ? ((entity!.data as T.RowData).spec as T.RowData) : null;
        const path = kind === 'variants' ? entity!.target.write.relPath : gameTablePaths[kind];
        const location = {
          source: origin,
          root: source.manifest.modRoot,
          path: source.manifest.modRoot + '/' + path,
          relPath: path,
          ...(origin === 'reference' ? { reference } : {}),
        };
        const projection = kind === 'wings' ? project.graph('wing', id) : kind === 'variants' ? project.graph('variant', id) : null;
        const resourceRefs = source.resources(kind === 'weapons' ? 'weapon' : kind === 'hullmods' ? 'hullmods' : 'ship', id, spec ?? data);
        for (const resource of Object.values(resourceRefs))
          Object.assign(resource, {
            source: resource.source === 'core' ? 'core' : origin,
            ...(origin === 'reference' ? { reference } : {}),
          });
        const projectileId = spec?.projectileSpecId;
        const projectile =
          typeof projectileId === 'string'
            ? project
                .sources()
                .flatMap((source) => [...source.entities.values()])
                .find((entity) => entity.kind === 'projectile' && entity.id === projectileId)
            : null;
        return {
          id,
          label: String(data.name ?? data.displayName ?? id),
          data,
          spec,
          source: location,
          sourceVersion: source.version(location.path),
          specSource: entity?.target.source ?? null,
          specVersion: entity?.baseVersions[0] ?? null,
          resourceRefs,
          primaryRole: String(data['role desc'] ?? data.role ?? ''),
          moduleHull:
            kind === 'variants'
              ? { id: String(data.hullId), name: String(projection!.hull!.spec.hullName), hints: projection!.hull!.hints }
              : null,
          preview: projection
            ? {
                hull: projection.hull!,
                spec: projection.hull!.spec,
                specs: projection.records
                  .filter((record) => record.target.kind === 'spec' && record.value.state === 'present')
                  .map((record) => ({
                    kind: (record.target as Extract<T.JointRecordTarget, { kind: 'spec' }>).target.kind,
                    id: (record.target as Extract<T.JointRecordTarget, { kind: 'spec' }>).target.id,
                    data: (record.value as Extract<T.JointValue, { state: 'present' }>).value,
                    source: record.source,
                    sourceVersion: record.sourceVersion,
                    resourceRefs: record.resourceRefs,
                  })),
              }
            : null,
          projectile: projectile
            ? {
                kind: 'projectile' as const,
                id: projectile.id,
                data: (projectile.data as T.RowData).spec!,
                source: projectile.target.source,
                sourceVersion: projectile.baseVersions[0]!,
                resourceRefs: projectile.resourceRefs,
              }
            : null,
        };
      });
  });
}

export function gameQuery(project: WorkspaceProject, command: string, payload: Record<string, unknown>): unknown {
  if (command === 'save_misc_config' || command === 'delete_misc_config') {
    const file = project.model.miscFiles.find((file) => file.kind === payload.kind);
    const path = file?.path ?? project.manifest.modRoot + '/' + miscConfigFile(String(payload.kind)).path;
    if (command === 'delete_misc_config') project.textFiles.delete(path);
    else project.textFiles.set(path, JSON.stringify(payload.data, null, 2) + '\n');
    return project.write(
      payload.data as T.RowData,
      { kind: 'json', origin: { kind: 'miscConfig', file: payload.kind as T.MiscConfigKind } },
      [path],
    );
  }
  const sources = project.sources();
  const groups = sources.map((source) => ({
    source,
    origin: source.manifest.modRoot === coreRoot ? ('core' as const) : source === project ? ('mod' as const) : ('reference' as const),
    reference: { sessionId: source.manifest.sessionId, modRoot: source.manifest.modRoot },
  }));
  if (command === 'query_csv_table_index' || command === 'query_csv_table_rows') {
    const input = payload as unknown as T.CsvTableIndexPayload & T.CsvTableRowsPayload;
    const search = input.search?.toLowerCase();
    const table = project.tables.get(input.table)!,
      path = project.manifest.modRoot + '/' + gameTablePaths[input.table];
    const rows =
      command === 'query_csv_table_rows'
        ? input.rowKeys.map((key) => table.rows.find((row) => row.rowKey === key)!)
        : table.rows.filter(
            (row) =>
              !search ||
              (input.searchField === 'id'
                ? [row.data.id ?? row.data['variant id']]
                : input.searchField === 'name'
                  ? [row.data.name]
                  : Object.values(row.data)
              ).some((value) =>
                String(value ?? '')
                  .toLowerCase()
                  .includes(search),
              ),
          );
    return {
      table: input.table,
      header: table.header,
      totalRows: table.rows.length,
      rowKeys: rows.map((row) => row.rowKey),
      rows: command === 'query_csv_table_rows' ? rows : rows.slice(0, input.initialCount),
      baseVersions: [project.version(path)],
    };
  }
  if (command === 'save_csv_patch') {
    const input = payload as unknown as T.CsvSave,
      table = project.tables.get(input.table)!;
    for (const patch of input.patches) {
      const index = table.rows.findIndex((row) => row.rowKey === patch.rowKey);
      if (patch.action === 'delete') table.rows.splice(index, 1);
      else if (index >= 0) table.rows[index] = { rowKey: patch.rowKey, data: patch.row, isComment: patch.isComment };
      else table.rows.splice(patch.insertAt ?? table.rows.length, 0, { rowKey: patch.rowKey, data: patch.row, isComment: patch.isComment });
    }
    const rows = input.rowOrder ? input.rowOrder.map((key) => table.rows.find((row) => row.rowKey === key)!) : table.rows;
    const keyMap: T.CsvRowKeyMapping[] = [];
    rows.forEach((row, rowIndex) => {
      if (row.rowKey.startsWith(input.table + ':new:')) {
        const previousKey = row.rowKey;
        row.rowKey = project.nextCsvRowKey(input.table);
        keyMap.push({ previousKey, nextKey: row.rowKey, rowIndex });
      }
    });
    const path = project.manifest.modRoot + '/' + gameTablePaths[input.table];
    for (const { change, target } of input.associatedSpecs ?? []) {
      if (change.action === 'delete' || change.action === 'rename') project.textFiles.delete(target.source?.path ?? target.write.path);
      if (change.action !== 'delete') {
        const params = change.create;
        const data =
          params.kind === 'ship'
            ? createShipSpec(params.id, params.hullName)
            : params.kind === 'weapon'
              ? createWeaponSpec(params.id, params.specClass)
              : params.kind === 'skill'
                ? createSkillSpec(params.id)
                : createSystemSpec(params.id);
        project.textFiles.set(target.write.path, JSON.stringify(data, null, 2) + '\n');
      }
    }
    project.textFiles.set(
      path,
      renderGameCsv(
        table.header,
        rows.map((row) => Object.fromEntries(Object.entries(row.data).map(([key, value]) => [key, String(value ?? '')]))),
      ),
    );
    table.rows = rows;
    const result = project.write(null, { kind: 'csv', table: input.table }, [
      path,
      ...(input.associatedSpecs ?? []).map(({ target }) => target.write.path),
    ]);
    result.keyMap = keyMap;
    return result;
  }
  if (command === 'query_hull_references') {
    const result: T.HullReferencesResult = {
      groups: [],
      hullNames: {},
      sprites: {},
      builtInWeaponSlots: {},
      weaponSlots: {},
      moduleSlots: {},
    };
    for (const { source, origin, reference } of groups)
      for (const kind of ['ship', 'skin'] as const)
        result.groups.push({
          origin,
          kind,
          ...(origin === 'reference' ? { reference } : {}),
          options: [...source.entities.values()]
            .filter((entity) => entity.kind === kind)
            .map((entity) => ({
              label: String((entity.data as T.RowData).hullName ?? entity.id),
              value: entity.id,
              origin,
              kind,
              resourceRef: entity.resourceRefs.sprite ?? null,
            })),
        });
    for (const id of payload.referenceIds as string[]) {
      if (!sources.some((source) => source.entities.has(source.entityKey('ship', id)) || source.entities.has(source.entityKey('skin', id))))
        continue;
      const kind = sources.some((source) => source.entities.has(source.entityKey('skin', id))) ? 'skin' : 'ship';
      const hull = project.graph(kind, id).hull!;
      result.hullNames[id] = String(hull.spec.hullName ?? id);
      if (hull.sprite) result.sprites[id] = hull.sprite;
      const slots = (hull.slots as T.RowData[]).map((slot) => ({
        id: String(slot.id),
        size: String(slot.size),
        type: String(slot.type),
        mount: String(slot.mount),
        origin: hull.sprite?.source ?? 'mod',
      }));
      result.weaponSlots[id] = slots.filter((slot) => !['STATION_MODULE', 'DECORATIVE', 'SYSTEM'].includes(slot.type));
      result.moduleSlots[id] = slots.filter((slot) => slot.type === 'STATION_MODULE');
      result.builtInWeaponSlots[id] = result.weaponSlots[id]!.filter((slot) => Object.hasOwn(hull.builtInWeapons, slot.id));
    }
    return result;
  }
  if (command === 'query_resource_data_urls')
    return {
      entries: (payload.resources as T.ResourceRef[]).map((resource) => {
        const unavailable =
          resource.source === 'reference' &&
          !sources.some(
            (source) =>
              source !== project &&
              source.manifest.sessionId === resource.reference?.sessionId &&
              source.manifest.modRoot === resource.reference?.modRoot,
          );
        return {
          ...resource,
          ...(unavailable ? { error: { code: 'reference.unavailable', message: '引用来源已不可用', location: null } } : {}),
          dataUrl: unavailable
            ? null
            : (gameImages.get(
                (resource.source === 'core' ? coreRoot : (resource.reference?.modRoot ?? project.manifest.modRoot)) +
                  '/' +
                  resource.relPath,
              ) ?? null),
        };
      }),
    };
  if (command === 'query_engine_render_assets') {
    const styles = Object.assign(
      {},
      ...[...sources]
        .reverse()
        .map((source) => JSON.parse(source.textFiles.get(source.manifest.modRoot + '/data/config/engine_styles.json') ?? '{}')),
    );
    const resources: Record<string, T.ResourceRef> = {};
    for (const style of Object.values(styles) as T.RowData[])
      for (const field of ['glowSprite', 'glowOutline'])
        if (typeof style[field] === 'string') {
          const relPath = style[field] as string;
          resources[relPath] = {
            ...project.resources('ship', 'engines', { [field]: relPath })[field]!,
            relPath,
            ownerKind: 'ship',
            ownerId: 'engines',
            key: field,
          };
        }
    for (const relPath of ['graphics/fx/engineglow32.png', 'graphics/fx/engineflame32.png', 'graphics/fx/hit_glow.png'])
      resources[relPath] = { source: 'core', relPath, ownerKind: 'ship', ownerId: 'engines', key: relPath };
    return { styles, resources, versions: [] };
  }
  if (command === 'query_csv_row_preview') {
    const row = project.tables.get(payload.table as T.CsvTableKey)!.rows.find((row) => row.rowKey === payload.rowKey);
    if (!row || row.isComment) return { resourceRef: null };
    const id = String(row.data.id);
    if (payload.table === 'wings') return { resourceRef: project.graph('wing', id).hull!.sprite };
    if (payload.table === 'simOpponents') return { resourceRef: project.graph('variant', String(row.data['variant id'])).hull!.sprite };
    const table = payload.table as T.ResourceOwnerKind,
      field = iconFields[table as T.CsvTableKey];
    if (field) {
      const resource = project.resources(table, id, row.data)[table === 'hullmods' ? 'icon' : field];
      return { resourceRef: resource ? { ...resource, key: 'icon' } : null };
    }
    const entity = sources.flatMap((source) => [...source.entities.values()]).find((entity) => entity.id === id);
    return {
      resourceRef:
        entity?.resourceRefs.sprite ?? entity?.resourceRefs.turretSprite ?? project.resources('hullmods', id, row.data).icon ?? null,
    };
  }
  if (command === 'query_image_source_options')
    return groups.map(({ source, origin, reference }) => ({
      origin,
      ...(origin === 'reference' ? { reference } : {}),
      options: [...gameImages.keys()]
        .filter((path) => path.startsWith(source.manifest.modRoot + '/'))
        .map((path) => path.slice(source.manifest.modRoot.length + 1))
        .filter((path) => (payload.directories as string[]).some((directory) => path.startsWith(directory + '/')))
        .map((value) => ({ label: value.split('/').at(-1), value, origin, description: null, resourceRef: null })),
    }));
  if (command === 'query_csv_source_options') {
    const query = String(payload.source),
      parsed = parseCsvSource(query);
    return groups.map(({ source, origin, reference }) => {
      const data = isConfigSource(query)
        ? (JSON.parse(source.textFiles.get(source.manifest.modRoot + '/' + CONFIG_OPTION_SOURCES[query]) ?? '{}') as T.RowData)
        : {};
      const entityKind =
        query === 'csv:projectiles.id'
          ? 'projectile'
          : query === 'csv:variants.variantId'
            ? 'variant'
            : query === 'hull:ids'
              ? 'ship'
              : null;
      const entries = entityKind
        ? [...source.entities.values()].filter(({ kind }) => kind === entityKind).map(({ id }) => ({ value: id, label: id }))
        : parsed
          ? source.tables
              .get(parsed.table)!
              .rows.filter(({ data }) => data[parsed.column] !== undefined && data[parsed.column] !== '')
              .map(({ data }) => ({
                value: String(data[parsed.column]),
                label: String(
                  parsed.column === 'id' || parsed.column === 'variant id' ? (data.name ?? data[parsed.column]) : data[parsed.column],
                ),
              }))
          : Object.keys(query === 'config:designTypes' ? ((data.designTypeColors as T.RowData) ?? {}) : data).map((value) => ({
              value,
              label: value,
            }));
      return {
        origin,
        ...(origin === 'reference' ? { reference } : {}),
        options: [...new Map(entries.filter(({ value }) => value !== 'music').map((entry) => [entry.value, entry])).values()].map(
          (entry) => {
            const table = parsed?.table,
              row = table && source.tables.get(table)!.rows.find(({ data }) => data.id === entry.value);
            const field = table && iconFields[table];
            let resource =
              row && field
                ? source.resources(table as T.ResourceOwnerKind, entry.value, row.data)[field === 'sprite' ? 'icon' : field]
                : null;
            if (resource && resource.source !== 'core')
              resource = { ...resource, source: origin, ...(origin === 'reference' ? { reference } : {}) };
            return { ...entry, origin, description: null, resourceRef: resource ?? null };
          },
        ),
      };
    });
  }
  throw Error('Unsupported game dataset query: ' + command);
}
