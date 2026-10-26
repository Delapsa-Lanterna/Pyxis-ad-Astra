import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryMiscConfigFiles, queryMiscConfigFile } from './misc-config.service';
import {
  querySessionEntity,
  querySessionEntityList,
  querySessionEntityEditTarget,
  querySessionEntityIdentityIntent,
  hasEntityInvalidation,
} from './entity-query.service';
import { queryTableIndex, querySessionCsvRowPreview, hasTableInvalidation } from './csv-table.service';
import { querySourceOptionCatalog, hasSourceInvalidation } from './source-options.service';
import { querySessionHullReferences } from './hull-reference.service';
import { querySessionDraftResources, resolveModImageReference } from './resource-reference.service';
import {
  queryJointEdit,
  queryJointCandidate,
  queryJointEditProjection,
  queryJointVariantCatalog,
  prepareJointEdit,
} from './joint-edit.service';
import { invalidateQueryCacheByProject, invalidateQueryCacheForSession } from './query-cache.service';
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
  ...['config:sounds', 'config:designTypes', 'config:hullStyles'].map((source) => ({
    name: source,
    read: () => querySourceOptionCatalog(session, source),
    matching: scope('csv-source-options', { source }),
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
  {
    name: 'joint-edit-catalog',
    read: () => queryJointVariantCatalog(root, 'weapons'),
    matching: changed,
    unrelated: detail,
    value: { root, referenceSettings: snapshot.referenceSettings, catalog: { kind: 'weapons', entries: [] } },
  },
  { name: 'joint-edit-projection', read: () => queryJointEditProjection(draft), matching: changed, unrelated: detail, value: snapshot },
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

describe('business-owned query invalidation', () => {
  it.each(cases)('$name ends a matching pending request', async ({ read, matching, value }) => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = read();
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
    invalidateQueryCacheByProject(session, unrelated);
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(value);
    await expect(pending).resolves.toEqual(value);
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
    expect(hasEntityInvalidation(event, 'entity-detail', 'ship', 'demo')).toBe(true);
    expect(hasEntityInvalidation(event, 'entity-detail', 'weapon', 'demo')).toBe(false);
    expect(hasTableInvalidation({ ...event, invalidation: scope('csv-table-window') }, 'csv-table-window', 'ships')).toBe(true);
    expect(hasSourceInvalidation({ ...event, invalidation: scope('csv-source-options') }, 'csv:ships.id')).toBe(true);
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
