import type * as T from '@/shared/types';
import { TABLE_KEYS } from '@/shared/types';
import { createBrowserModel } from './scenarios/model';
import { entityTargetFixture } from '../fixtures/entity-target';
import { MISC_CONFIG_FILES } from '@/domain/json-editor/misc-config-files';
import { entityContentId } from '@/domain/project/entity-definitions';
import { gameFiles, gameImages, gameRoot, coreRoot, gameTablePaths, readGameCsv } from './game-files';
import { renderGameCsv } from './game-format';
import { buildGameJoint } from './game-joint';
import { gameQuery, gameCatalog, gameCommands } from './game-queries';
import { installModelQueries } from './runtime/commands';

export interface GameSource {
  manifest: T.ProjectManifest;
  textFiles: Map<string, string>;
  tables: Map<T.CsvTableKey, { header: string[]; rows: T.CsvRowRecord[] }>;
  entities: Map<string, T.EntityData>;
  entityKey(kind: T.EntityKind, id: string): string;
  version(path: string): T.FileVersion;
  resources(kind: T.EntityKind | T.ResourceOwnerKind, id: string, data: T.RowData): Record<string, T.ResourceRef>;
}
export function createWorkspaceProject(root: string, index: number) {
  const model = createBrowserModel('csv', 0, 'workspace-' + index, 0, root);
  const manifest = model.manifest;
  const textFiles = new Map([...gameFiles].filter(([path]) => path.startsWith(root + '/')));
  const versions = new Map([...textFiles.keys()].map((path) => [path, '1']));
  const tables = new Map<T.CsvTableKey, { header: string[]; rows: T.CsvRowRecord[] }>();
  const rowSequences = new Map<T.CsvTableKey, number>();
  function nextCsvRowKey(table: T.CsvTableKey) {
    const sequence = rowSequences.get(table) ?? 0;
    rowSequences.set(table, sequence + 1);
    return table + ':row:' + sequence;
  }
  const entities = new Map<string, T.EntityData>();
  const entityKey = (kind: T.EntityKind, id: string) => kind + ':' + id;
  let revision = 1;
  let sources: () => GameSource[];
  const history: T.FileHistorySnapshot = { revision: 0, undoStack: [], redoStack: [] };
  const snapshots: Map<string, string>[] = [];
  const redos: Map<string, string>[] = [];
  let committed = new Map(textFiles);
  const version = (path: string) => ({ path, fingerprint: textFiles.has(path) ? (versions.get(path) ?? '1') : null });
  function resources(kind: T.EntityKind | T.ResourceOwnerKind, id: string, data: T.RowData) {
    const result: Record<string, T.ResourceRef> = {};
    for (const [key, value] of Object.entries(data))
      if (typeof value === 'string' && /\.(png|svg|jpg)$/.test(value)) {
        result[kind === 'hullmods' && key === 'sprite' ? 'icon' : key === 'spriteName' ? 'sprite' : key] = {
          source: root === coreRoot || !gameImages.has(root + '/' + value) ? 'core' : 'mod',
          relPath: value,
          ownerKind: kind === 'projectile' ? 'weapon' : kind === 'system' ? 'shipSystems' : kind === 'skill' ? 'skills' : kind,
          ownerId: id,
          key,
        };
      }
    return result;
  }
  function reindex() {
    manifest.modRoot = root;
    manifest.starsectorRoot = gameRoot;
    manifest.coreAvailable = true;
    manifest.modInfo =
      root === coreRoot
        ? { id: 'starsector-core', name: '远行星号原版', version: '0.98a-RC8' }
        : JSON.parse(textFiles.get(root + '/mod_info.json')!);
    manifest.baseVersions = [...versions.keys()].map(version);
    for (const table of TABLE_KEYS) {
      const path = root + '/' + gameTablePaths[table],
        text = textFiles.get(path);
      const parsed = text === undefined ? { header: [], rows: [] } : readGameCsv(text);
      const old = [...(tables.get(table)?.rows ?? [])];
      const rows = parsed.rows.map((data) => {
        const index = old.findIndex(
          (row) => row.data.id === data.id && row.data['variant id'] === data['variant id'] && row.data.type === data.type,
        );
        return { rowKey: index >= 0 ? old.splice(index, 1)[0]!.rowKey : nextCsvRowKey(table), data, isComment: false };
      });
      tables.set(table, { header: parsed.header, rows });
      manifest.tableSummaries[table] = {
        path: gameTablePaths[table],
        header: parsed.header,
        totalRows: rows.length,
        available: text !== undefined,
      };
      manifest.tableEntitySummaries[table] = rows.length;
    }
    entities.clear();
    const kinds: Record<string, T.EntityKind> = {
      ship: 'ship',
      wpn: 'weapon',
      proj: 'projectile',
      system: 'system',
      skill: 'skill',
      variant: 'variant',
      skin: 'skin',
      faction: 'faction',
    };
    for (const [path, text] of textFiles) {
      const kind = kinds[path.split('.').at(-1)!];
      if (!kind) continue;
      const spec = JSON.parse(text) as T.RowData;
      const id = entityContentId(kind, spec);
      const target = entityTargetFixture(kind, id, 'existing', root);
      target.write.relPath = path.slice(root.length + 1);
      target.write.path = path;
      target.source = { ...target.write, source: root === coreRoot ? 'core' : 'mod' };
      const table =
        kind === 'ship' ? 'ships' : kind === 'weapon' ? 'weapons' : kind === 'system' ? 'shipSystems' : kind === 'skill' ? 'skills' : null;
      const row = table ? tables.get(table)!.rows.find((row) => row.data.id === id) : undefined;
      if (row) target.linkedRecord = { kind: 'csv', table: table!, rowKey: row.rowKey };
      const data = kind === 'weapon' || kind === 'projectile' ? { spec, csvRow: row?.data ?? {} } : spec;
      entities.set(entityKey(kind, id), { kind, id, data, target, baseVersions: [version(path)], resourceRefs: resources(kind, id, spec) });
    }
    for (const [path, text] of textFiles)
      if (path.endsWith('/descriptor.json')) {
        const id = path.split('/').at(-2)!,
          directory = path.slice(0, -'descriptor.json'.length);
        const target = entityTargetFixture('mission', id, 'existing', root);
        const descriptor = JSON.parse(text) as T.RowData;
        const list = readGameCsv(textFiles.get(root + '/data/missions/mission_list.csv')!).rows.find((row) => row.mission === id)!;
        entities.set(entityKey('mission', id), {
          kind: 'mission',
          id,
          target,
          data: { descriptor, text: textFiles.get(directory + 'mission_text.txt')!, list },
          baseVersions: [version(path)],
          resourceRefs: resources('mission', id, { icon: 'data/missions/' + id + '/' + descriptor.icon }),
        });
      }
    const names: Record<T.EntityKind, keyof T.ProjectManifest['entitySummaries']> = {
      ship: 'ships',
      weapon: 'weapons',
      projectile: 'projectiles',
      system: 'systems',
      skill: 'skills',
      faction: 'factions',
      variant: 'variants',
      skin: 'skins',
      mission: 'missions',
    };
    for (const key of Object.values(names)) manifest.entitySummaries[key] = 0;
    for (const entity of entities.values()) manifest.entitySummaries[names[entity.kind]]++;
    manifest.associatedSpecTables = (['ships', 'weapons', 'wings', 'shipSystems'] as const).filter(
      (key) => tables.get(key)!.rows.length > 0,
    );
    model.miscFiles.splice(
      0,
      model.miscFiles.length,
      ...MISC_CONFIG_FILES.filter(({ path }) => textFiles.has(root + '/' + path)).map(({ kind, path }) => ({
        kind,
        path: root + '/' + path,
        relPath: path,
        data: JSON.parse(textFiles.get(root + '/' + path)!) as T.RowData,
        baseVersions: [version(root + '/' + path)],
      })),
    );
  }
  function linkVariantSprites() {
    for (const entity of entities.values()) {
      if (entity.kind !== 'variant' && (entity.kind !== 'skin' || (entity.data as T.RowData).spriteName)) continue;
      const hullId = String((entity.data as T.RowData)[entity.kind === 'skin' ? 'baseHullId' : 'hullId'] ?? '');
      const source = sources().find((candidate) => candidate.entities.has(candidate.entityKey('ship', hullId)));
      const sprite = source?.entities.get(source.entityKey('ship', hullId))?.resourceRefs.sprite;
      if (!sprite || !source) continue;
      const core = source.manifest.modRoot === coreRoot;
      entity.resourceRefs = {
        ...entity.resourceRefs,
        sprite: {
          ...sprite,
          source: core ? 'core' : source === project ? 'mod' : 'reference',
          ownerKind: entity.kind,
          ownerId: entity.id,
          key: 'sprite',
          ...(!core && source !== project ? { reference: { sessionId: source.manifest.sessionId, modRoot: source.manifest.modRoot } } : {}),
        },
      };
    }
  }
  function write<V>(value: V, target: T.WriteContentTarget, paths: string[], replay = false) {
    const changed = [...new Set([...committed.keys(), ...textFiles.keys()])].filter((path) => committed.get(path) !== textFiles.get(path));
    if (changed.length && !replay) {
      snapshots.push(committed);
      redos.length = 0;
      history.redoStack = [];
      history.undoStack.push({
        id: revision,
        timestamp: Date.now(),
        paths: changed,
        label: target.kind === 'csv' ? target.table : target.kind,
      });
    }
    revision++;
    paths.forEach((path) => versions.set(path, String(revision)));
    reindex();
    linkVariantSprites();
    const result = model.receipt(value, target);
    result.baseVersions = paths.map(version);
    result.invalidation = { ...result.invalidation, session: true, paths, tables: [...TABLE_KEYS] };
    result.sessionUpdates[0]!.projection.invalidation = result.invalidation;
    history.revision++;
    result.history = structuredClone(history);
    result.changes = changed.map((path) => ({
      kind: 'file',
      beforePath: path,
      afterPath: path,
      beforeExists: committed.has(path),
      afterExists: textFiles.has(path),
      beforeText: committed.get(path) ?? null,
      afterText: textFiles.get(path) ?? null,
      beforeDataBase64: null,
      afterDataBase64: null,
      beforeFiles: [],
      afterFiles: [],
    }));
    committed = new Map(textFiles);
    return result;
  }
  function saveEntity(target: T.EntityEditTarget, data: T.RowData) {
    textFiles.set(
      target.write.path,
      JSON.stringify(target.kind === 'weapon' || target.kind === 'projectile' ? data.spec : data, null, 2) + '\n',
    );
    return write(data, { kind: 'spec', target }, [target.write.path]);
  }
  function undo(direction: 'undo' | 'redo' = 'undo') {
    const from = direction === 'undo' ? snapshots : redos,
      to = direction === 'undo' ? redos : snapshots;
    const previous = from.pop();
    if (!previous) return model.receipt(null);
    to.push(new Map(textFiles));
    const stack = direction === 'undo' ? history.undoStack : history.redoStack;
    (direction === 'undo' ? history.redoStack : history.undoStack).push(stack.pop()!);
    textFiles.clear();
    previous.forEach((text, path) => textFiles.set(path, text));
    return write(null, { kind: 'json', origin: { kind: 'modInfo' } }, [...previous.keys()], true);
  }
  const graph = (kind: T.JointEditKind, id?: string, values: Record<string, T.JointValue> | null = null): T.JointEditSnapshot => {
    const targetId =
      id ??
      (kind === 'wing'
        ? tables.get('wings')!.rows[0]!.data.id!
        : sources()
            .flatMap((source) => [...source.entities.values()])
            .find((entity) => entity.kind === kind)!.id);
    return buildGameJoint(project, { sessionId: manifest.sessionId, modRoot: root, kind, id: String(targetId) }, values);
  };
  function queryJoint(input: T.JointEditQuery) {
    const { kind, id } = input.root;
    const table = kind === 'ship' ? 'ships' : kind === 'weapon' ? 'weapons' : kind === 'wing' ? 'wings' : null;
    const rowId = !id && input.rowKey && table ? tables.get(table)!.rows.find((row) => row.rowKey === input.rowKey)?.data.id : null;
    return graph(kind, id || String(rowId ?? ''), input.values);
  }
  function saveJoint(payload: T.SaveJointEditPayload) {
    const changed: string[] = [];
    for (const record of payload.snapshot.records) {
      const value = payload.values[record.key];
      if (!value || value.state !== 'present') continue;
      if (record.target.kind === 'spec') {
        const path = root + '/' + record.target.target.write.relPath;
        textFiles.set(path, JSON.stringify(value.value, null, 2) + '\n');
        changed.push(path);
      } else if (record.target.kind === 'csv') {
        const table = record.target.table,
          path = root + '/' + gameTablePaths[table],
          target = record.target;
        const parsed = textFiles.has(path)
          ? readGameCsv(textFiles.get(path)!)
          : {
              header: sources()
                .find((source) => source.tables.get(table)!.header.length)!
                .tables.get(table)!.header,
              rows: [] as Record<string, string>[],
            };
        const index = parsed.rows.findIndex((row) => Object.entries(target.identity).every(([key, value]) => row[key] === value));
        if (index < 0) parsed.rows.push(value.value as Record<string, string>);
        else parsed.rows[index] = value.value as Record<string, string>;
        textFiles.set(path, renderGameCsv(parsed.header, parsed.rows));
        changed.push(path);
      }
    }
    const result = write(null, { kind: 'joint', root: payload.snapshot.root }, changed);
    return {
      ...result,
      content: {
        target: { kind: 'joint' as const, root: payload.snapshot.root },
        value: graph(payload.snapshot.root.kind, payload.snapshot.root.id),
      },
    };
  }
  function document(command: string, input: T.IndexedConfigSave & T.IndexedConfigDelete & T.JsonFileSave & T.JsonFileDelete) {
    const indexed = command.includes('indexed_config');
    const kind = indexed ? input.kind : command.includes('variant') ? 'variant' : 'skin';
    const deleting = command.startsWith('delete'),
      previous = input.previousId ?? input.entityId ?? input.id;
    const id = deleting ? previous : input.nextId;
    const existing = entities.get(entityKey(kind, previous));
    const next = entityTargetFixture(kind, id, 'existing', root);
    const before = existing?.target.write.path;
    const data = deleting
      ? (existing!.data as T.RowData)
      : indexed
        ? kind === 'faction'
          ? (input.entityData.file as T.RowData)
          : { ...input.entityData, list: input.indexRow }
        : input.data;
    const touched: string[] = [];
    if (kind === 'mission') {
      const prefix = `${root}/data/missions/`;
      if (previous && previous !== id)
        for (const [path, text] of [...textFiles])
          if (path.startsWith(prefix + previous + '/')) {
            textFiles.delete(path);
            textFiles.set(prefix + id + path.slice((prefix + previous).length), text);
            touched.push(path);
          }
      for (const [name, content] of [
        ['descriptor.json', JSON.stringify(data.descriptor, null, 2)],
        ['mission_text.txt', String(data.text ?? '')],
      ] as const) {
        const path = prefix + id + '/' + name;
        if (deleting) textFiles.delete(path);
        else textFiles.set(path, content);
        touched.push(path);
      }
    } else {
      const path = input.relPath && previous === id ? root + '/' + input.relPath : previous === id && before ? before : next.write.path;
      if (before && (deleting || before !== path)) {
        textFiles.delete(before);
        touched.push(before);
      }
      if (!deleting) textFiles.set(path, JSON.stringify(data, null, 2) + '\n');
      touched.push(path);
      next.write.path = path;
      next.write.relPath = path.slice(root.length + 1);
    }
    const indexPath = root + (kind === 'faction' ? '/data/world/factions/factions.csv' : '/data/missions/mission_list.csv');
    const index = indexed ? readGameCsv(textFiles.get(indexPath) ?? (kind === 'faction' ? 'faction\n' : 'mission\n')) : null;
    if (index) {
      index.rows = index.rows.filter((row) =>
        kind === 'faction' ? row.faction !== existing?.target.write.relPath : row.mission !== previous,
      );
      if (!deleting)
        index.rows.push(
          kind === 'faction'
            ? { faction: next.write.relPath }
            : Object.fromEntries(Object.entries(input.indexRow).map(([key, value]) => [key, String(value ?? '')])),
        );
      textFiles.set(indexPath, renderGameCsv(index.header, index.rows));
      touched.push(indexPath);
    }
    const origin: T.JsonDocumentOrigin = { kind: 'entity', target: { kind, id, relPath: next.write.relPath } };
    const value = indexed
      ? {
          entityId: id,
          indexPath,
          indexHeader: index!.header,
          indexRows: index!.rows.map((data) => ({ data, isComment: false })),
          entityData: deleting ? null : kind === 'faction' ? { file: data } : data,
        }
      : deleting
        ? null
        : { id, data, path: next.write.path, relPath: next.write.relPath };
    const result = write(value, { kind: 'json', origin }, touched);
    if (existing && previous !== id && !deleting)
      result.identityChanges.push({ before: existing.target, after: entities.get(entityKey(kind, id))!.target });
    return result;
  }
  reindex();
  const project = {
    model,
    manifest,
    tables,
    nextCsvRowKey,
    entities,
    textFiles,
    versions,
    history,
    snapshots,
    redos,
    write,
    saveEntity,
    undo,
    entityKey,
    version,
    resources,
    graph,
    queryJoint,
    saveJoint,
    document,
    sources: () => sources(),
    setSources(value: () => GameSource[]) {
      sources = value;
      linkVariantSprites();
    },
  };
  sources = () => [project];
  linkVariantSprites();
  model.graph = graph;
  model.project = (target, values = null) => graph(target.kind, target.id, values);
  model.saveJoint = saveJoint;
  model.catalog = (kind) => gameCatalog(project, kind);
  installModelQueries(model, (command, payload) => {
    if (gameCommands.has(command)) return gameQuery(project, command, payload);
    if (command === 'query_joint_edit') {
      const input = payload as unknown as T.JointEditQuery;
      return input.catalog
        ? {
            root: input.root,
            referenceSettings: { values: {}, versions: [], resources: {} },
            catalog: {
              kind: input.catalog,
              entries: model.catalog(input.catalog).filter((entry) => !input.catalogSource || entry.source.source === input.catalogSource),
            },
          }
        : queryJoint(input);
    }
    return undefined;
  });
  model.resourceDataUrl = (path) => {
    return (
      sources()
        .map((source) => gameImages.get(source.manifest.modRoot + '/' + path))
        .find(Boolean) ?? ''
    );
  };
  model.windowContext = (kind) => {
    const snapshot = graph(kind);
    model.context = {
      label: 'browser-' + kind,
      revision: 1,
      requestId: 1,
      receiverGeneration: 1,
      title: String(manifest.modInfo!.name),
      kind: 'immersive-editor',
      identity: { type: 'immersive', ...snapshot.root },
      input: { kind: 'immersive-editor', rowKey: null },
    };
    return model.context;
  };
  return project;
}
export type WorkspaceProject = ReturnType<typeof createWorkspaceProject>;
