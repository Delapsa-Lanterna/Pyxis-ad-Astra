import { describe, expect, it } from 'vitest';
import { createBrowserModel, sampleRoot } from './model';
import { installBrowserModel, invoke } from '../runtime/commands';
import { listen, emitTo, eventListenerCount } from '../runtime/events';
import { resourceImage } from '../../fixtures/resources';
import { jointObject } from '@/domain/joint-edit';
import { createSettingsFixture } from '../../fixtures/settings';
import type { CsvTableIndex, JointEditKind, SaveCsvPatchPayload, SettingsSnapshot, PerformanceMonitorStatus } from '@/shared/types';

describe('browser sample service', () => {
  it('routes targeted events and releases their listeners', async () => {
    const received: string[] = [];
    const first = await listen(
      'fixture-target',
      () => {
        received.push('A');
      },
      { target: 'A' },
    );
    const second = await listen(
      'fixture-target',
      () => {
        received.push('B');
      },
      { target: 'B' },
    );
    const before = eventListenerCount();
    await emitTo('A', 'fixture-target', null);
    expect(received).toEqual(['A']);
    first();
    second();
    expect(eventListenerCount()).toBe(before - 2);
  });
  it('generates independent deterministic resources at each pressure size', () => {
    for (const size of [32, 128, 512]) {
      const first = resourceImage(size, 'first');
      expect(first).toBe(resourceImage(size, 'first'));
      expect(first).not.toBe(resourceImage(size, 'second'));
      expect(decodeURIComponent(first)).toContain(`width="${size}" height="${size}"`);
      const model = createBrowserModel('weapons', 30, 'resources', size);
      const resources = model.catalog('weapons').map((entry) => entry.resourceRefs.sprite!.relPath);
      expect(new Set(resources).size).toBe(30);
    }
  });
  it('delivers monitor samples and maintains reset, export and detailed recording state', async () => {
    const model = createBrowserModel('settings');
    installBrowserModel(model);
    await invoke('performance_monitor_batch', { batch: { samples: [{}, {}] } });
    expect(model.monitor.records).toBe(2);
    expect(await invoke<PerformanceMonitorStatus>('performance_monitor_report', { action: 'traceStart', traceSeconds: 7 })).toMatchObject({
      traceState: 'recording',
      traceSeconds: 7,
    });
    expect(await invoke('performance_monitor_report', { action: 'traceStop' })).toMatchObject({ traceState: 'ready' });
    expect(await invoke('performance_monitor_report', { action: 'export' })).toMatchObject({
      path: 'M:/tool-data/performance-monitor/sample.json',
    });
    expect(await invoke('performance_monitor_report', { action: 'reset' })).toMatchObject({ records: 0, overwritten: 0 });
  });
  it('saves settings with revisions and a change event, and restores formal defaults', async () => {
    const model = createBrowserModel('settings');
    installBrowserModel(model);
    const revisions: number[] = [];
    const before = eventListenerCount();
    const stop = await listen('app-settings-changed', (event) => {
      revisions.push((event.payload as SettingsSnapshot).revision);
    });
    const settings = model.settings;
    settings.logLevel = 'debug';
    const saved = await invoke<SettingsSnapshot>('save_settings', { payload: { settings } });
    expect(saved.value.logLevel).toBe('debug');
    expect(revisions).toEqual([saved.revision]);
    expect(await invoke('read_settings')).toEqual(saved);
    const defaults = await invoke('read_default_settings');
    expect(defaults).toEqual(createSettingsFixture());
    await invoke('save_settings', { payload: { settings: defaults } });
    expect(model.settings.logLevel).toBe('info');
    stop();
    expect(eventListenerCount()).toBe(before);
  });

  it('searches the selected field and reads identities in requested order', async () => {
    installBrowserModel(createBrowserModel('csv', 50));
    const query = async (searchField: string, search: string) =>
      invoke<CsvTableIndex>('query_csv_table_index', { payload: { table: 'ships', searchField, search, initialCount: 2 } });
    expect((await query('name', ' ship 12 ')).rowKeys).toEqual(['ships:row:12']);
    expect((await query('id', 'Sample')).rowKeys).toEqual([]);
    expect((await query('id-name', 'Sample')).rowKeys).toHaveLength(50);
    expect((await query('id-name', ' ')).rows).toHaveLength(2);
    expect(await invoke('query_csv_table_rows', { payload: { table: 'ships', rowKeys: ['ships:row:3', 'ships:row:1'] } })).toMatchObject({
      rows: [{ rowKey: 'ships:row:3' }, { rowKey: 'ships:row:1' }],
    });
  });

  it('saves mixed edits and complete row order, mapping new identities before reread', async () => {
    const model = createBrowserModel('csv', 4);
    installBrowserModel(model);
    const payload: SaveCsvPatchPayload = {
      sessionId: model.sessionId,
      modRoot: sampleRoot,
      table: 'ships',
      baseVersions: [],
      associatedSpecs: [],
      rowOrder: ['ships:new:1', 'ships:row:3', 'ships:row:0', 'ships:row:1'],
      patches: [
        { action: 'delete', rowKey: 'ships:row:2', row: {}, isComment: false },
        { action: 'upsert', rowKey: 'ships:row:1', row: { id: 'edited', name: 'Saved' }, isComment: false },
        { action: 'upsert', rowKey: 'ships:new:1', row: {}, isComment: true },
      ],
    };
    const saved = model.saveCsv(payload);
    expect(saved.keyMap).toEqual([{ previousKey: 'ships:new:1', nextKey: 'ships:row:4', rowIndex: 0 }]);
    const reopened = await invoke<CsvTableIndex>('query_csv_table_index', {
      payload: { table: 'ships', searchField: 'id-name', search: '', initialCount: 240 },
    });
    expect(reopened.rowKeys).toEqual(['ships:row:4', 'ships:row:3', 'ships:row:0', 'ships:row:1']);
    expect(reopened.rows[0]).toMatchObject({ data: {}, isComment: true });
    expect(reopened.rows[3]!.data.name).toBe('Saved');
    expect(reopened.baseVersions).toEqual(saved.baseVersions);
  });

  it.each<JointEditKind>(['ship', 'weapon', 'wing', 'variant'])('saves and reopens the %s scene with consistent versions', (kind) => {
    const model = createBrowserModel(kind);
    const snapshot = model.graph(kind);
    model.windowContext(kind);
    const key = snapshot.bindings[kind === 'wing' ? 'csv' : 'spec']!;
    const value = {
      state: 'present' as const,
      value: { ...jointObject(snapshot.records.find((r) => r.key === key)!.value), browserEdited: 7 },
    };
    const saved = model.saveJoint({
      snapshot,
      values: { [key]: value },
      baseVersions: snapshot.baseVersions,
      jsonWrite: {},
      createOverrides: [],
    });
    model.windowContext(kind);
    const reopened = model.project(snapshot.root);
    expect(reopened.records.find((r) => r.key === key)!.value).toEqual(value);
    expect(reopened.baseVersions).toEqual(saved.baseVersions);
    expect(new Set(reopened.baseVersions.map((v) => v.path)).size).toBe(reopened.baseVersions.length);
  });

  it('keeps models independent, reports unsupported commands and retries an injected failure', async () => {
    const first = createBrowserModel('csv', 2);
    const second = createBrowserModel('csv', 2);
    first.rows[0]!.data.name = 'changed';
    expect(second.rows[0]!.data.name).toBe('Sample ship 0');
    installBrowserModel(first);
    first.failures.set('read_settings', 'sample read failed');
    await expect(invoke('read_settings')).rejects.toThrow('sample read failed');
    await expect(invoke('read_settings')).resolves.toEqual(first.settingsSnapshot());
    await expect(invoke('unsupported_sample_action')).rejects.toThrow('unsupported_sample_action');
    installBrowserModel(second);
    await expect(invoke('read_settings')).resolves.toEqual(second.settingsSnapshot());
  });

  it('keeps a failed save unchanged and synchronizes the original successful commit', async () => {
    const model = createBrowserModel('csv', 2);
    installBrowserModel(model);
    const payload: SaveCsvPatchPayload = {
      sessionId: model.sessionId,
      modRoot: sampleRoot,
      table: 'ships',
      baseVersions: [],
      associatedSpecs: [],
      rowOrder: null,
      patches: [{ action: 'upsert', rowKey: 'ships:row:1', row: { id: 'saved' }, isComment: false }],
    };
    model.failures.set('save_csv_patch', 'save failed');
    await expect(invoke('save_csv_patch', { payload })).rejects.toThrow('save failed');
    expect(model.rows[1]!.data.id).toBe('ship_1');
    const result = model.saveCsv(payload);
    expect(await invoke('synchronize_committed_write', { payload: { commitId: result.commitId } })).toEqual(result.sessionUpdates[0]);
    expect(model.commitId).toBe(1);
  });

  it('replaces a sample module while accepting drafts belonging to the previous module', () => {
    const model = createBrowserModel('variant');
    const baseline = model.project(model.graph('variant').root);
    const values = Object.fromEntries(baseline.records.map((record) => [record.key, record.value]));
    values.variant = { state: 'present', value: { ...jointObject(values.variant), modules: { MODULE: 'module_2' } } };
    const next = model.project(baseline.root, values);
    expect(next.hull!.modules).toEqual([{ slotId: 'MODULE', variantKey: 'module:module_2:variant' }]);
    expect(next.records.some((record) => record.key === 'module:module_2:variant')).toBe(true);
  });
  it('projects changed references and adds sources for all three equipment kinds', () => {
    const weapon = createBrowserModel('weapon'),
      snapshot = weapon.graph('weapon');
    const value = { state: 'present' as const, value: { ...jointObject(snapshot.records[0]!.value), projectileSpecId: 'sample_shot' } };
    const projection = weapon.project(snapshot.root, { spec: value });
    expect(projection.records.find((r) => r.key === 'projectile')!.target).toMatchObject({ target: { id: 'sample_shot' } });
    const model = createBrowserModel('variant'),
      base = model.graph('variant');
    const variant = {
      ...jointObject(base.records.find((r) => r.key === 'variant')!.value),
      hullId: 'sample_hull',
      weaponGroups: [{ mode: 'LINKED', weapons: { WS2: 'weapon_1' } }],
      wings: ['wing_1'],
      hullMods: ['hullmod_1'],
    };
    const graph = model.project(base.root, { variant: { state: 'present', value: variant } });
    for (const [table, id] of [
      ['weapons', 'weapon_1'],
      ['wings', 'wing_1'],
      ['hullmods', 'hullmod_1'],
    ])
      expect(graph.records.some((r) => r.target.kind === 'csv' && r.target.table === table && r.target.identity.id === id)).toBe(true);
    expect(graph.records.find((r) => r.key === graph.hull!.hullKey)!.target).toMatchObject({ target: { id: 'sample_hull' } });
    expect(Object.keys(graph.variants)).toContain('wings:wing_1:variant');
    model.windowContext('variant');
    model.saveJoint({
      snapshot: base,
      values: { variant: { state: 'present', value: variant } },
      baseVersions: base.baseVersions,
      jsonWrite: {},
      createOverrides: [],
    });
    expect(model.project(base.root).variants.variant!.weapons.WS2).toBe('weapon_1');
  });
});
