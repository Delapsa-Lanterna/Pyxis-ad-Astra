import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  queryJointEdit,
  queryJointEditRow,
  queryJointEditProjection,
  queryJointCandidate,
  queryJointVariantCatalog,
  prepareJointEdit,
  saveJointEdit,
} from './joint-edit.service';
import {
  invalidateQueryCacheForSession,
  invalidateQueryCacheByProject,
  hasQueryInvalidation,
  subscribeQueryInvalidations,
} from './query-cache.service';
import type { JointEditSnapshot } from '@/shared/types';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const root = { sessionId: 'joint-service', modRoot: 'M:/mod', kind: 'ship' as const, id: 'a' };
const snapshot: JointEditSnapshot = {
  root,
  bindings: {},
  referenceSettings: { values: {}, versions: [], resources: {} },
  records: [],
  baseVersions: [],
  hull: null,
  variants: {},
  catalog: null,
  newSources: [],
};
beforeEach(() => {
  invoke.mockReset();
  invalidateQueryCacheForSession(root.sessionId);
});
describe('joint edit capability protocols', () => {
  it('caches module catalogs independently by source', async () => {
    invoke.mockResolvedValue({ root, referenceSettings: snapshot.referenceSettings, catalog: { kind: 'variants', entries: [] } });
    await queryJointVariantCatalog(root, 'variants', undefined, 'mod');
    await queryJointVariantCatalog(root, 'variants', undefined, 'core');
    await queryJointVariantCatalog(root, 'variants', undefined, 'mod');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls.map((call) => call[1].payload.catalogSource)).toEqual(['mod', 'core']);
  });
  it('reuses catalog reads and refreshes after project changes', async () => {
    const read = { root, referenceSettings: snapshot.referenceSettings, catalog: { kind: 'weapons', entries: [] } };
    invoke.mockResolvedValue(read);
    await Promise.all([queryJointVariantCatalog(root, 'weapons'), queryJointVariantCatalog(root, 'weapons')]);
    await queryJointVariantCatalog(root, 'weapons');
    expect(invoke).toHaveBeenCalledTimes(1);
    let refreshed = false;
    const stop = subscribeQueryInvalidations((event) => {
      refreshed = hasQueryInvalidation(event, 'joint-edit-catalog');
    });
    invalidateQueryCacheByProject(root.sessionId, {
      paths: ['data/weapons/weapon_data.csv'],
      tables: [],
      entities: [],
      resources: [],
      queryScopes: [],
      session: false,
    });
    await queryJointVariantCatalog(root, 'weapons');
    expect(refreshed).toBe(true);
    stop();
    expect(invoke).toHaveBeenCalledTimes(2);
    await queryJointVariantCatalog(root, 'wings');
    expect(invoke).toHaveBeenCalledTimes(3);
  });
  it('carries persisted row identity and independent draft projection inputs', async () => {
    invoke.mockResolvedValue(snapshot);
    await queryJointEditRow(root, 'ships:row:2');
    expect(invoke).toHaveBeenLastCalledWith('query_joint_edit', {
      payload: { root: { ...root, id: '' }, rowKey: 'ships:row:2', values: null, newSources: [], catalog: null },
    });
    const values = { csv: { state: 'present' as const, value: { 'system id': 'next' } } };
    await queryJointEditProjection({ baseline: snapshot, values });
    expect(invoke).toHaveBeenLastCalledWith('query_joint_edit', { payload: { root, rowKey: null, values, newSources: [], catalog: null } });
  });
  it('maps query, preparation and submission to their formal payloads', async () => {
    invoke.mockResolvedValue(snapshot);
    await expect(queryJointEdit(root)).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenLastCalledWith('query_joint_edit', {
      payload: { root, rowKey: null, values: null, newSources: [], catalog: null },
    });
    const draft = { baseline: snapshot, values: {} };
    invoke.mockResolvedValue({ snapshot, values: {}, conflicts: [] });
    await prepareJointEdit(draft);
    expect(invoke).toHaveBeenLastCalledWith('prepare_joint_edit', { payload: draft });
    const payload = {
      snapshot,
      values: {},
      baseVersions: [],
      jsonWrite: { preserveOriginalJson: false, confirmedSources: [] },
      createOverrides: [],
    };
    invoke.mockResolvedValue({ refreshedEntity: snapshot });
    await saveJointEdit(payload);
    expect(invoke).toHaveBeenLastCalledWith('save_joint_edit', { payload });
  });
  it('shares read-only candidate snapshots and invalidates them with the session', async () => {
    invoke.mockResolvedValue(snapshot);
    await Promise.all([queryJointCandidate(root), queryJointCandidate(root)]);
    await queryJointCandidate(root);
    expect(invoke).toHaveBeenCalledTimes(1);
    invalidateQueryCacheForSession(root.sessionId);
    await queryJointCandidate(root);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('immediately ends invalidated live reads and retains the command error cause', async () => {
    let finish!: (value: JointEditSnapshot) => void;
    invoke.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const read = queryJointEdit(root);
    invalidateQueryCacheForSession(root.sessionId);
    await expect(read).rejects.toMatchObject({ code: 'query.invalidated' });
    finish(snapshot);
    const diagnostic = { code: 'joint.target_changed', message: 'source changed', location: null };
    invoke.mockRejectedValueOnce(diagnostic);
    await expect(queryJointEdit(root)).rejects.toMatchObject({ command: 'query_joint_edit', cause: diagnostic });
  });
});
