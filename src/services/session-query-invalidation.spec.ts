import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { queryMiscConfigFiles, queryMiscConfigFile } from './misc-config.service';
import {
  querySessionEntity,
  querySessionEntityList,
  querySessionEntityEditTarget,
  querySessionEntityIdentityIntent,
  hasEntityInvalidation,
} from './entity-query.service';
import { queryTableIndex, querySessionCsvRowPreview, queryCsvValidation, hasTableInvalidation } from './csv-table.service';
import { querySourceOptionCatalog, hasSourceInvalidation } from './source-catalog.service';
import { querySessionHullReferences } from './hull-reference.service';
import { querySessionDraftResources, resolveModImageReference } from './resource-reference.service';
import {
  queryJointEdit,
  queryJointCandidate,
  queryJointEditPreview,
  queryJointVariantCatalog,
  prepareJointEdit,
} from './joint-edit.service';
import { invalidateQueryCacheByProject, invalidateQueryCacheForSession } from './query-cache.service';
import { CONFIG_FIELD_SOURCES, ENTITY_FIELD_SOURCES } from '@/domain/schema/schema-source-definitions';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import type { JointEditSnapshot, ProjectInvalidation, InvalidatedQueryScope } from '@/shared/types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const session = 'owned-query-rules';
const root = { sessionId: session, modRoot: 'M:/mod', kind: 'ship' as const, id: 'demo' };
const snapshot: JointEditSnapshot = {
  root,
  records: [],
  bindings: {},
  referenceSettings: { values: {}, versions: [], resources: {} },
  baseVersions: [],
  hull: null,
  variants: {},
  catalog: null,
  newSources: [],
};
const draft = { baseline: snapshot, values: {} };
const source = entityTargetFixture('ship', 'demo');
const empty: ProjectInvalidation = { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false };
const scope = (kind: InvalidatedQueryScope['kind'], extra: Partial<InvalidatedQueryScope> = {}): ProjectInvalidation => ({
  ...empty,
  queryScopes: [{ kind, table: null, source: null, entity: null, resource: null, ...extra }],
});
const detail = scope('entity-detail', { entity: { kind: 'ship', id: 'demo' } });
const unrelated = scope('entity-detail', { entity: { kind: 'ship', id: 'other' } });
const changed = { ...empty, paths: ['data/hulls/demo.ship'] };
const cases: Array<{
  name: string;
  read: () => Promise<unknown>;
  matching: ProjectInvalidation;
  unrelated: ProjectInvalidation;
  value: unknown;
}> = [
  ...ENTITY_FIELD_SOURCES.map((source) => ({
    name: source,
    read: () => querySourceOptionCatalog(session, source),
    matching: scope('csv-source-options', { source }),
    unrelated: scope('csv-source-options', { source: 'csv:ships.id' }),
    value: [],
  })),
  ...Object.entries(CONFIG_FIELD_SOURCES).map(([source, relPath]) => ({
    name: source,
    read: () => querySourceOptionCatalog(session, source),
    matching: { ...empty, resources: [{ source: 'mod' as const, relPath }] },
    unrelated: scope('csv-source-options', { source: 'csv:ships.id' }),
    value: [],
  })),
  {
    name: 'misc-config',
    read: () => queryMiscConfigFiles(session, 'M:/mod'),
    matching: { ...empty, paths: ['M:/mod/data/strings/strings.json'] },
    unrelated: { ...empty, paths: ['M:/other/data/strings/strings.json'] },
    value: [],
  },
  {
    name: 'misc-config-file',
    read: () => queryMiscConfigFile(session, 'M:/mod', 'strings'),
    matching: { ...empty, paths: ['M:/mod/data/strings/strings.json'] },
    unrelated: { ...empty, paths: ['M:/mod/data/other.json'] },
    value: null,
  },
  { name: 'entity-detail', read: () => querySessionEntity(session, 'ship', 'demo'), matching: detail, unrelated, value: null },
  {
    name: 'entity-list',
    read: () => querySessionEntityList(session, 'ship'),
    matching: scope('entity-list', { entity: { kind: 'ship', id: 'demo' } }),
    unrelated: scope('entity-list', { entity: { kind: 'weapon', id: null } }),
    value: [],
  },
  {
    name: 'entity-edit-target',
    read: () => querySessionEntityEditTarget(session, 'ship', 'demo'),
    matching: detail,
    unrelated,
    value: { target: source, baseVersions: [] },
  },
  {
    name: 'entity-identity-intent',
    read: () => querySessionEntityIdentityIntent(session, source, 'next'),
    matching: scope('entity-detail', { entity: { kind: 'ship', id: 'next' } }),
    unrelated,
    value: {},
  },
  {
    name: 'csv-table-window',
    read: () => queryTableIndex(session, 'ships', 50, null, 'id-name'),
    matching: scope('csv-table-window', { table: 'ships' }),
    unrelated: scope('csv-table-window', { table: 'weapons' }),
    value: { rows: [] },
  },
  {
    name: 'csv-row-preview',
    read: () => querySessionCsvRowPreview(session, 'ships', 'row'),
    matching: scope('csv-row-preview', { table: 'ships' }),
    unrelated: scope('csv-row-preview', { table: 'weapons' }),
    value: { resourceRef: null },
  },
  {
    name: 'csv-source-options',
    read: () => querySourceOptionCatalog(session, 'csv:ships.id'),
    matching: scope('csv-source-options', { source: 'csv:ships.id' }),
    unrelated: scope('csv-source-options', { source: 'csv:ships.name' }),
    value: [],
  },
  {
    name: 'hull-references',
    read: () => querySessionHullReferences(session, ['demo']),
    matching: scope('hull-references'),
    unrelated: detail,
    value: {},
  },
  {
    name: 'draft-resources',
    read: () => querySessionDraftResources(session, 'ship', 'demo', { spriteName: 'graphics/current.png' }),
    matching: detail,
    unrelated,
    value: {},
  },
  {
    name: 'resource-reference',
    read: () => resolveModImageReference(session, 'M:/mod', 'M:/mod/graphics/current.png'),
    matching: { ...empty, session: true },
    unrelated: detail,
    value: 'graphics/current.png',
  },
  { name: 'joint-edit', read: () => queryJointEdit(root), matching: changed, unrelated: detail, value: snapshot },
  { name: 'joint-edit-candidate', read: () => queryJointCandidate(root), matching: changed, unrelated: detail, value: snapshot },
  ...(
    [
      ['weapons', 'data/weapons/demo.wpn', 'data/hulls/demo.ship'],
      ['wings', 'data/hulls/demo.ship', 'data/characters/skills/demo.skill'],
      ['hullmods', 'data/hullmods/hull_mods.csv', 'data/hulls/demo.ship'],
      ['variants', 'data/variants/demo.variant', 'data/weapons/demo.wpn'],
    ] as const
  ).map(([kind, matching, unrelated]) => ({
    name: 'joint-edit-catalog:' + kind,
    read: () => queryJointVariantCatalog(root, kind),
    matching: { ...empty, paths: [matching] },
    unrelated: { ...empty, paths: [unrelated] },
    value: { root, referenceSettings: snapshot.referenceSettings, catalog: { kind, entries: [] } },
  })),
  { name: 'joint-edit-candidate', read: () => queryJointEditPreview(draft), matching: changed, unrelated: detail, value: snapshot },
  {
    name: 'joint-edit-prepare',
    read: () => prepareJointEdit(draft),
    matching: changed,
    unrelated: detail,
    value: { snapshot, values: {}, conflicts: [] },
  },
];
beforeEach(() => invoke.mockReset());
afterEach(() => invalidateQueryCacheForSession(session));

function releasePendingQueries(finish: () => void, reads: Promise<unknown>[]) {
  const completed = Promise.allSettled(reads);
  onTestFinished(async () => {
    finish();
    await completed;
  });
}

describe('business-owned query invalidation', () => {
  it('shares validation dependencies across callers and reloads their changed resources', async () => {
    const request = { entities: [], sources: [], files: ['graphics/sample.png'], classes: [] };
    const value = { complete: true, entities: {}, sources: {}, files: { 'graphics/sample.png': true }, classes: {} };
    let finish!: (value: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = queryCsvValidation(session, request),
      second = queryCsvValidation(session, request);
    releasePendingQueries(() => finish(value), [first, second]);
    expect(invoke).toHaveBeenCalledTimes(1);
    finish(value);
    await Promise.all([first, second]);
    await queryCsvValidation(session, request);
    invalidateQueryCacheByProject(session, detail);
    await queryCsvValidation(session, request);
    expect(invoke).toHaveBeenCalledTimes(1);
    invalidateQueryCacheByProject(session, { ...empty, resources: [{ source: 'core', relPath: 'graphics' }] });
    invoke.mockResolvedValue(value);
    await Promise.all([queryCsvValidation(session, request), queryCsvValidation(session, request)]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it.each(
    cases.filter(
      ({ name }) =>
        name.startsWith('config:') ||
        name.startsWith('joint-edit-catalog:') ||
        ['entity-detail', 'entity-list', 'csv-table-window', 'csv-row-preview', 'csv-source-options', 'hull-references'].includes(name),
    ),
  )('$name shares pending and ready results and reloads once after invalidation', async ({ read, matching, unrelated, value }) => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = read(),
      second = read();
    releasePendingQueries(() => finish(value), [first, second]);
    expect(invoke).toHaveBeenCalledTimes(1);
    finish(value);
    await Promise.all([first, second]);
    await read();
    invalidateQueryCacheByProject(session, unrelated);
    await read();
    expect(invoke).toHaveBeenCalledTimes(1);
    invalidateQueryCacheByProject(session, matching);
    invoke.mockResolvedValue(value);
    await Promise.all([read(), read()]);
    await read();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it.each(cases)('$name ends a matching pending request', async ({ read, matching, value }) => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = read();
    releasePendingQueries(() => finish(value), [pending]);
    const ended = expect(pending).rejects.toMatchObject({ code: 'query.invalidated', cause: { reason: 'project' } });
    invalidateQueryCacheByProject(session, matching);
    await ended;
    finish(value);
  });
  it.each(cases)('$name retains a pending request across unrelated changes', async ({ read, unrelated, value }) => {
    let finish!: (value: unknown) => void,
      settled = false;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = read().finally(() => {
      settled = true;
    });
    releasePendingQueries(() => finish(value), [pending]);
    invalidateQueryCacheByProject(session, unrelated);
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(value);
    await expect(pending).resolves.toEqual(value);
  });
  it.each(
    Object.entries(CONFIG_FIELD_SOURCES).flatMap(([source, path]) =>
      (['mod', 'core'] as const).flatMap((origin) => [path, 'data/config'].map((relPath) => ({ source, origin, relPath }))),
    ),
  )('reloads $source for $origin resource scope $relPath', async ({ source, origin, relPath }) => {
    invoke.mockResolvedValue([]);
    await querySourceOptionCatalog(session, source);
    const invalidation = { ...empty, resources: [{ source: origin, relPath }] };
    expect(hasSourceInvalidation(invalidation, source)).toBe(true);
    invalidateQueryCacheByProject(session, invalidation);
    await Promise.all([querySourceOptionCatalog(session, source), querySourceOptionCatalog(session, source)]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(hasSourceInvalidation({ ...empty, resources: [{ source: origin, relPath: '' }] }, source)).toBe(true);
    expect(hasSourceInvalidation({ ...empty, resources: [{ source: origin, relPath: 'data/configuration' }] }, source)).toBe(false);
  });
  it.each(['csv:ships.id', 'ships.id'])('matches table-wide option invalidation for %s', async (name) => {
    invoke.mockResolvedValue([]);
    await querySourceOptionCatalog(session, name);
    invalidateQueryCacheByProject(session, scope('csv-source-options', { table: 'ships' }));
    await querySourceOptionCatalog(session, name);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('uses broad entity scopes while distinguishing unrelated IDs and kinds', () => {
    const event = {
      sessionId: session,
      scope: 'paths' as const,
      queries: [],
      invalidation: scope('entity-detail', { entity: { kind: 'ship', id: null } }),
    };
    expect(hasEntityInvalidation(event.invalidation, 'entity-detail', 'ship', 'demo')).toBe(true);
    expect(hasEntityInvalidation(event.invalidation, 'entity-detail', 'weapon', 'demo')).toBe(false);
    expect(hasTableInvalidation(scope('csv-table-window'), 'csv-table-window', 'ships')).toBe(true);
    expect(hasSourceInvalidation(scope('csv-source-options'), 'csv:ships.id')).toBe(true);
  });
  it('captures cached joint inputs independently of caller mutations', async () => {
    invoke.mockResolvedValue(snapshot);
    const input = { ...root };
    const read = queryJointCandidate(input);
    input.id = 'later';
    await read;
    expect(invoke.mock.lastCall![1].payload.root.id).toBe('demo');
    await queryJointCandidate(root);
    expect(invoke).toHaveBeenCalledOnce();
  });
});
