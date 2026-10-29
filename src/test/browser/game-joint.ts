import type * as T from '@/shared/types';
import type { WorkspaceProject } from './game-project';
import { gameTablePaths } from './game-files';
import { entityTargetFixture } from '../fixtures/entity-target';
import { jointObject } from '@/domain/joint-edit';
import { variantModuleEntries } from '@/domain/json-editor/json-variant-modules';
import skinFields from '../../../schemas/skin-hull-fields.json';

export function buildGameJoint(
  project: WorkspaceProject,
  root: T.JointEditRoot,
  values: Record<string, T.JointValue> | null,
): T.JointEditSnapshot {
  const records = new Map<string, T.JointEditRecord>();
  const variants: Record<string, T.JointHullProjection> = {};
  const binding: Record<string, string> = {};
  const sources = project.sources();
  const data = (key: string) => jointObject(records.get(key)!.value);
  function csv(table: T.CsvTableKey, id: string, type?: string) {
    const source =
      sources.find((source) => source.tables.get(table)!.rows.some((row) => row.data.id === id && (!type || row.data.type === type))) ??
      project;
    const row = source.tables.get(table)!.rows.find((row) => row.data.id === id && (!type || row.data.type === type));
    const path = source.manifest.modRoot + '/' + gameTablePaths[table];
    const key = table + ':' + id + ':' + (type ?? '');
    if (!records.has(key)) {
      const location = {
        source:
          source === project
            ? ('mod' as const)
            : source.manifest.modRoot.endsWith('/starsector-core')
              ? ('core' as const)
              : ('reference' as const),
        root: source.manifest.modRoot,
        path,
        relPath: gameTablePaths[table],
        ...(source === project ? {} : { reference: { sessionId: source.manifest.sessionId, modRoot: source.manifest.modRoot } }),
      };
      const value: T.JointValue = values?.[key] ?? { state: 'present', value: { id, ...(type ? { type } : {}), ...(row?.data ?? {}) } };
      records.set(key, {
        key,
        target: {
          kind: 'csv',
          table,
          rowKey: row?.rowKey ?? key,
          identity: { id, ...(type ? { type } : {}) },
          write: { ...location, root: project.manifest.modRoot, path: project.manifest.modRoot + '/' + gameTablePaths[table] },
        },
        source: row ? location : null,
        sourceVersion: source.version(path),
        baseVersions: [source.version(path)],
        value,
        resourceRefs: source.resources(
          table === 'ships' || table === 'wings' || table === 'descriptions' || table === 'simOpponents'
            ? 'ship'
            : table === 'weapons'
              ? 'weapon'
              : table,
          id,
          row?.data ?? {},
        ),
        referencedBy: [],
      });
    }
    return key;
  }
  function spec(kind: T.EntityKind, id: string) {
    const key = kind + ':' + id;
    if (records.has(key)) return key;
    const source = sources.find((source) => source.entities.has(source.entityKey(kind, id)));
    if (!source) throw Error(`Missing ${kind} source ${id}`);
    const entity = source.entities.get(source.entityKey(kind, id))!;
    const target = entityTargetFixture(kind, id, source === project ? 'existing' : 'create', project.manifest.modRoot);
    target.write.relPath = entity.target.write.relPath;
    target.write.path = project.manifest.modRoot + '/' + target.write.relPath;
    target.source = {
      ...entity.target.source!,
      source: source === project ? 'mod' : source.manifest.modRoot.endsWith('/starsector-core') ? 'core' : 'reference',
      ...(source === project ? {} : { reference: { sessionId: source.manifest.sessionId, modRoot: source.manifest.modRoot } }),
    };
    const value = values?.[key] ?? {
      state: 'present' as const,
      value: structuredClone(kind === 'weapon' || kind === 'projectile' ? (entity.data as T.RowData).spec! : entity.data),
    };
    const resources = Object.fromEntries(
      Object.entries(entity.resourceRefs).map(([key, resource]) => [
        key,
        {
          ...resource,
          source: resource.source === 'core' ? 'core' : target.source!.source,
          ...(source === project || resource.source === 'core'
            ? {}
            : { reference: { sessionId: source.manifest.sessionId, modRoot: source.manifest.modRoot } }),
        },
      ]),
    );
    records.set(key, {
      key,
      target: { kind: 'spec', target },
      source: target.source,
      sourceVersion: entity.baseVersions[0]!,
      baseVersions: entity.baseVersions,
      value,
      resourceRefs: resources,
      referencedBy: [],
    });
    return key;
  }
  function weapon(id: string) {
    const key = spec('weapon', id),
      row = csv('weapons', id),
      description = csv('descriptions', id, 'WEAPON');
    const projectile = data(key).projectileSpecId;
    if (typeof projectile === 'string' && sources.some((source) => source.entities.has(source.entityKey('projectile', projectile))))
      spec('projectile', projectile);
    return { spec: key, csv: row, description, ...(typeof projectile === 'string' ? { projectile: 'projectile:' + projectile } : {}) };
  }
  function hull(id: string, variantKey: string): T.JointHullProjection {
    const skin = sources.some((source) => source.entities.has(source.entityKey('skin', id))) ? spec('skin', id) : null;
    const hullId = skin ? String(data(skin).baseHullId) : id;
    const hullKey = spec('ship', hullId),
      rowKey = csv('ships', hullId);
    const base = data(hullKey),
      overlay = skin ? data(skin) : {};
    const description = csv('descriptions', String(overlay.descriptionId ?? id), 'SHIP');
    const slots = (base.weaponSlots as T.RowData[])
      .filter((slot) => !((overlay.removeWeaponSlots as string[]) ?? []).includes(String(slot.id)))
      .map((slot) => ({
        ...slot,
        ...((overlay.weaponSlotChanges as T.RowData | undefined)?.[String(slot.id)] as T.RowData | undefined),
      }));
    const ship: T.RowData = {
      ...base,
      ...(skin
        ? {
            hullId: id,
            hullName: overlay.hullName ?? base.hullName,
            spriteName: overlay.spriteName ?? base.spriteName,
            weaponSlots: slots,
            engineSlots: ((base.engineSlots as T.RowData[]) ?? []).filter(
              (_, index) => !((overlay.removeEngineSlots as number[]) ?? []).includes(index),
            ),
          }
        : {}),
    };
    const fields = Object.fromEntries(Object.keys(data(rowKey)).map((path) => [path, [{ recordKey: rowKey, path }]]));
    if (skin)
      for (const [field, paths] of Object.entries(skinFields))
        fields[field] = [{ recordKey: rowKey, path: field }, ...paths.map((path) => ({ recordKey: skin, path }))];
    const builtin = {
      ...Object.fromEntries(
        Object.entries((base.builtInWeapons as Record<string, string>) ?? {}).filter(
          ([slot]) => !((overlay.removeBuiltInWeapons as string[]) ?? []).includes(slot),
        ),
      ),
      ...(overlay.builtInWeapons as Record<string, string> | undefined),
    };
    const mods = [
      ...((base.builtInMods as string[]) ?? []).filter((id) => !((overlay.removeBuiltInMods as string[]) ?? []).includes(id)),
      ...((overlay.builtInMods as string[]) ?? []),
    ];
    const variant = data(variantKey);
    const weapons = { ...builtin, ...Object.assign({}, ...((variant.weaponGroups as T.RowData[]) ?? []).map((group) => group.weapons)) };
    for (const value of Object.values(weapons)) weapon(String(value));
    for (const value of [
      ...mods,
      ...((variant.hullMods as string[]) ?? []),
      ...((variant.permaMods as string[]) ?? []),
      ...((variant.sMods as string[]) ?? []),
    ])
      csv('hullmods', value);
    const systemId = String(overlay.systemId ?? data(rowKey)['system id'] ?? '');
    if (systemId && sources.some((source) => source.entities.has(source.entityKey('system', systemId)))) {
      spec('system', systemId);
      csv('shipSystems', systemId);
      csv('descriptions', systemId, 'SHIP_SYSTEM');
    }
    const result: T.JointHullProjection = {
      spec: ship,
      variantKey,
      hullKey,
      skinKeys: skin ? [skin] : [],
      fields,
      displayBindings: { csv: rowKey, description },
      weapons,
      sprite: (skin ? records.get(skin)!.resourceRefs.sprite : null) ?? records.get(hullKey)!.resourceRefs.sprite ?? null,
      slots,
      hints: String(data(rowKey).hints ?? '')
        .split(',')
        .map((value) => value.trim()),
      builtInWeapons: builtin,
      builtInMods: mods,
      builtInWings: (base.builtInWings as string[]) ?? [],
      modules: [],
    };
    variants[variantKey] = result;
    for (const [slotId, moduleId] of variantModuleEntries(variant.modules)) {
      const child = spec('variant', moduleId);
      hull(String(data(child).hullId), child);
      result.modules.push({ slotId, variantKey: child });
    }
    for (const wingId of [...result.builtInWings, ...((variant.wings as string[]) ?? [])].filter(Boolean)) wing(wingId);
    return result;
  }
  function wing(id: string) {
    const wingKey = csv('wings', id),
      variant = spec('variant', String(data(wingKey).variant));
    const projection = variants[variant] ?? hull(String(data(variant).hullId), variant);
    return {
      csv: wingKey,
      variant,
      hull: projection.hullKey,
      spec: projection.hullKey,
      hullCsv: projection.displayBindings.csv!,
      description: projection.displayBindings.description!,
      system: 'system:' + data(projection.displayBindings.csv!)['system id'],
    };
  }
  let projection: T.JointHullProjection | null = null;
  if (root.kind === 'weapon') Object.assign(binding, weapon(root.id));
  else if (root.kind === 'wing') {
    Object.assign(binding, wing(root.id));
    projection = variants[binding.variant!]!;
  } else {
    const key = spec(root.kind === 'variant' ? 'variant' : root.kind === 'skin' ? 'skin' : 'ship', root.id);
    projection = hull(root.kind === 'variant' ? String(data(key).hullId) : root.id, key);
    Object.assign(binding, {
      spec: key,
      csv: projection.displayBindings.csv,
      description: projection.displayBindings.description,
      system: 'system:' + data(projection.displayBindings.csv!)['system id'],
      ...(root.kind === 'variant' ? { variant: key } : {}),
    });
  }
  const settings = Object.assign(
    {},
    ...[...sources]
      .reverse()
      .map((source) => JSON.parse(source.textFiles.get(source.manifest.modRoot + '/data/config/settings.json') ?? '{}') as T.RowData),
  );
  return {
    root,
    records: [...records.values()],
    bindings: binding,
    referenceSettings: { values: settings, versions: [], resources: {} },
    baseVersions: [
      ...new Map([...records.values()].flatMap((record) => record.baseVersions).map((version) => [version.path, version])).values(),
    ],
    hull: projection,
    variants,
    catalog: null,
    newSources: [],
  };
}
