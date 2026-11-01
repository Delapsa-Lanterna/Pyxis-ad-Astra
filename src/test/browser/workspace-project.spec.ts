import { describe, expect, it } from 'vitest';
import type * as T from '@/shared/types';
import { gameImages } from './game-files';
import { formatModVersion } from '@/shared/lib/starsector';
import { buildModNavigationSections } from '@/domain/workspace/mod-navigation';
import { createBrowserWorkspace } from './workspace-runtime';
import { createWorkspaceProject, coreRoot, gameRoot, workspaceRoots } from './workspace-project';

describe('complete browser workspace fixtures', () => {
  it.each(['read', 'overwrite', 'csv'] as const)(
    'handles invalid original content and rejects stale files in browser mode %s',
    async (mode) => {
      const workspace = createBrowserWorkspace(),
        project = workspace.projects[1]!;
      const root = project.manifest.modRoot,
        source = root + '/data/hulls/previous.ship',
        target = root + '/data/hulls/next.ship';
      project.textFiles.set(source, '{broken');
      const text = '{"hullId":"next","custom":true}';
      project.textFiles.set(target, text);
      project.write(null, { kind: 'csv', table: 'ships' }, [source, target]);
      const change: T.AssociatedSpecChange = {
        action: 'rename',
        previousId: 'previous',
        create: { kind: 'ship', id: 'next', hullName: 'CSV name' },
      };
      const plan = (
        (await workspace.invoke('main', 'prepare_csv_associated_specs', {
          payload: { sessionId: project.manifest.sessionId, table: 'ships', changes: [change] },
        })) as T.AssociatedSpecPreparation[]
      )[0]!;
      expect(plan.original!.problem).toBeTruthy();
      const resolution = {
        mode: mode === 'read' ? ('read' as const) : ('overwrite' as const),
        original: plan.original,
        destination: plan.destination,
      };
      const input = {
        sessionId: project.manifest.sessionId,
        table: 'ships',
        patches: [{ rowKey: 'ships:new:0', action: 'upsert', row: { id: 'next', name: 'CSV name' }, isComment: false }],
        associatedSpecs: mode === 'csv' ? [] : [{ change, target: plan.target, resolution }],
      };
      const before = project.history.undoStack.length;
      await workspace.invoke('main', 'save_csv_patch', { payload: input });
      expect(project.history.undoStack).toHaveLength(before + 1);
      expect(project.textFiles.has(source)).toBe(mode === 'csv');
      if (mode !== 'overwrite') expect(project.textFiles.get(target)).toBe(text);
      else expect(JSON.parse(project.textFiles.get(target)!).custom).toBeUndefined();
      project.undo();
      project.textFiles.set(target, '{"hullId":"next","changed":true}');
      const rows = structuredClone(project.tables.get('ships')!.rows);
      await expect(
        workspace.invoke('main', 'save_csv_patch', {
          payload: { ...input, associatedSpecs: [{ change, target: plan.target, resolution }] },
        }),
      ).rejects.toThrow('关联文件已变化');
      expect(project.tables.get('ships')!.rows).toEqual(rows);
    },
  );
  it.each(['ships', 'weapons', 'shipSystems', 'skills'] as const)(
    'prepares and replays existing %s files through one save',
    async (table) => {
      for (const rename of [false, true])
        for (const mode of ['read', 'overwrite'] as const) {
          const workspace = createBrowserWorkspace(),
            project = workspace.projects[1]!;
          const kind = table === 'ships' ? 'ship' : table === 'weapons' ? 'weapon' : table === 'skills' ? 'skill' : 'system';
          const extension = { ship: 'ship', weapon: 'wpn', skill: 'skill', system: 'system' }[kind];
          const directory = { ship: 'data/hulls', weapon: 'data/weapons', skill: 'data/characters/skills', system: 'data/shipsystems' }[
            kind
          ];
          const field = kind === 'ship' ? 'hullId' : 'id';
          const destination = project.manifest.modRoot + '/' + directory + '/nested/prepared.' + extension;
          const targetText = JSON.stringify({ [field]: 'prepared', custom: 'preserve destination' }, null, 4) + '\n';
          const old = project.manifest.modRoot + '/' + directory + '/original.' + extension;
          project.textFiles.set(destination, targetText);
          if (rename) project.textFiles.set(old, JSON.stringify({ [field]: 'original', custom: 'preserve source', specClass: 'beam' }));
          project.write(null, { kind: 'csv', table }, [destination, ...(rename ? [old] : [])]);
          const create: T.AssociatedSpecCreateParams =
            kind === 'ship'
              ? { kind, id: 'prepared', hullName: 'CSV name' }
              : kind === 'weapon'
                ? { kind, id: 'prepared', specClass: 'beam' as const }
                : { kind, id: 'prepared' };
          const change: T.AssociatedSpecChange = rename
            ? { action: 'rename', previousId: 'original', create }
            : { action: 'create', create };
          const input = { sessionId: project.manifest.sessionId, table, changes: [change] };
          const plans = (await workspace.invoke('main', 'prepare_csv_associated_specs', {
            payload: input,
          })) as T.AssociatedSpecPreparation[];
          const plan = plans[0]!;
          const beforeHistory = project.history.undoStack.length;
          const saved = (await workspace.invoke('main', 'save_csv_patch', {
            payload: {
              sessionId: project.manifest.sessionId,
              table,
              patches: [{ rowKey: table + ':new:0', action: 'upsert', row: { id: 'prepared', name: 'CSV name' }, isComment: false }],
              associatedSpecs: [
                { change, target: plan.target, resolution: { mode, original: plan.original, destination: plan.destination } },
              ],
            },
          })) as T.WriteResult;
          expect(saved.history.undoStack).toHaveLength(beforeHistory + 1);
          if (mode === 'read') expect(project.textFiles.get(destination)).toBe(targetText);
          else expect(JSON.parse(project.textFiles.get(destination)!)[field]).toBe('prepared');
          if (rename) expect(project.textFiles.has(old)).toBe(false);
          expect(workspace.calls.filter((call) => call.command === 'prepare_csv_associated_specs')).toHaveLength(1);
          project.undo();
          expect(project.textFiles.get(destination)).toBe(targetText);
          if (rename) expect(project.textFiles.has(old)).toBe(true);
          project.undo('redo');
          if (rename) expect(project.textFiles.has(old)).toBe(false);
        }
    },
  );
  it('returns an empty preview for draft and comment rows', async () => {
    const workspace = createBrowserWorkspace(),
      project = workspace.projects[1]!;
    const payload = { sessionId: project.manifest.sessionId, table: 'ships' };
    expect(await workspace.invoke('main', 'query_csv_row_preview', { payload: { ...payload, rowKey: 'ships:new:0' } })).toEqual({
      resourceRef: null,
    });
    const row = project.tables.get('ships')!.rows[0]!;
    row.isComment = true;
    expect(await workspace.invoke('main', 'query_csv_row_preview', { payload: { ...payload, rowKey: row.rowKey } })).toEqual({
      resourceRef: null,
    });
  });
  it('preserves independent duplicate row identities through consecutive saves and reloads', async () => {
    const workspace = createBrowserWorkspace(),
      project = workspace.projects[1]!;
    const original = structuredClone(project.tables.get('ships')!.rows);
    const save = async (rowKey: string, data: T.RowData, order: string[]) =>
      workspace.invoke('main', 'save_csv_patch', {
        payload: {
          sessionId: project.manifest.sessionId,
          table: 'ships',
          patches: [{ rowKey, action: 'upsert', row: data, isComment: false }],
          rowOrder: order,
          associatedSpecs: [],
        },
      }) as Promise<T.WriteResult<null>>;
    const result = await save('ships:new:0', { ...original[0]!.data }, [
      original[0]!.rowKey,
      'ships:new:0',
      ...original.slice(1).map((row) => row.rowKey),
    ]);
    const saved = project.tables.get('ships')!.rows;
    expect(result.keyMap).toEqual([{ previousKey: 'ships:new:0', nextKey: saved[1]!.rowKey, rowIndex: 1 }]);
    expect(new Set(saved.map((row) => row.rowKey)).size).toBe(original.length + 1);
    expect(saved[0]!.data).toEqual(saved[1]!.data);
    const copiedKey = saved[1]!.rowKey;
    await save(
      copiedKey,
      { ...saved[1]!.data, name: 'Independent copy' },
      saved.map((row) => row.rowKey),
    );
    project.write(null, { kind: 'csv', table: 'ships' }, []);
    const reloaded = project.tables.get('ships')!.rows;
    expect(reloaded.map((row) => row.rowKey)).toEqual(saved.map((row) => row.rowKey));
    expect(reloaded[0]!.data).toEqual(original[0]!.data);
    expect(reloaded[1]!.data.name).toBe('Independent copy');
  });
  it('delivers resource failures per item and withdraws closed reference sources', async () => {
    const workspace = createBrowserWorkspace(),
      owner = workspace.projects[0]!,
      external = workspace.projects[1]!;
    await workspace.invoke('main', 'set_reference_sources', { sessionIds: [external.manifest.sessionId] });
    const resource = Object.values(
      [...external.entities.values()].find((entity) => Object.keys(entity.resourceRefs).length)!.resourceRefs,
    )[0]!;
    const reference: T.ResourceRef = {
      ...resource,
      source: 'reference',
      reference: {
        sessionId: external.manifest.sessionId,
        modRoot: external.manifest.modRoot,
      },
    };
    const read = (resources: T.ResourceRef[]) =>
      workspace.invoke('main', 'query_resource_data_urls', {
        payload: { sessionId: owner.manifest.sessionId, resources },
      }) as Promise<T.ResourceDataUrlBatchResult>;
    const mixed = await read([reference, { ...reference, reference: undefined }]);
    expect(mixed.entries[0]!.error).toBeUndefined();
    expect(mixed.entries[1]).toMatchObject({ dataUrl: null, error: { code: 'reference.unavailable' } });
    await workspace.invoke('main', 'set_reference_sources', { sessionIds: [] });
    expect((await read([reference])).entries[0]!.error?.code).toBe('reference.unavailable');
  });
  it('scans Mod metadata from its files through saves and sample restoration', async () => {
    const workspace = createBrowserWorkspace(),
      owner = workspace.projects[1]!,
      original = structuredClone(owner.manifest.modInfo!);
    const scan = async () => (await workspace.invoke('main', 'scan_game_overview')) as T.GameOverviewData;
    expect((await scan()).mods[0]).toMatchObject({
      id: original.id,
      name: original.name,
      version: formatModVersion(original.version),
      description: original.description,
    });
    await workspace.invoke('main', 'save_mod_info', {
      payload: {
        sessionId: owner.manifest.sessionId,
        data: { ...original, name: 'Edited metadata', version: '2.4', description: 'Saved description' },
      },
    });
    workspace.reopen();
    expect((await scan()).mods[0]).toMatchObject({ name: 'Edited metadata', version: '2.4', description: 'Saved description' });
    workspace.restoreSample();
    expect((await scan()).mods[0]).toMatchObject({
      name: original.name,
      version: formatModVersion(original.version),
      description: original.description,
    });
    expect(workspace.state.mods[0]!.version).toBe(formatModVersion(original.version));
  });

  it('exposes sampled entities, distinct faction artwork, table images and existing simulator variants', async () => {
    const workspace = createBrowserWorkspace();
    expect(workspace.projects[0]!.manifest.entitySummaries).toMatchObject({ factions: 3, missions: 2, skins: 3 });
    for (const project of workspace.projects) {
      const payload = { sessionId: project.manifest.sessionId };
      const entries = [...project.entities.values()];
      const faction = entries.find((entry) => entry.kind === 'faction')!;
      expect(faction.resourceRefs.crest!.relPath).not.toBe(faction.resourceRefs.logo!.relPath);
      for (const kind of ['faction', 'mission', 'skin'] as const) {
        const entity = entries.find((entry) => entry.kind === kind);
        if (!entity) continue;
        const resource = entity.resourceRefs[kind === 'faction' ? 'crest' : kind === 'mission' ? 'icon' : 'sprite']!;
        expect(gameImages.has(project.manifest.modRoot + '/' + resource.relPath)).toBe(true);
      }
      const sim = project.tables.get('simOpponents')!;
      expect(sim.rows).toHaveLength(project === workspace.projects[0] ? 3 : 2);
      for (const row of sim.rows) expect(project.entities.has('variant:' + row.data['variant id'])).toBe(true);
      for (const table of ['industries', 'simOpponents'] as const)
        for (const row of project.tables.get(table)!.rows) {
          const { resourceRef } = (await workspace.invoke('main', 'query_csv_row_preview', {
            payload: { ...payload, table, rowKey: row.rowKey },
          })) as T.CsvRowPreview;
          expect(resourceRef).not.toBeNull();
          const result = (await workspace.invoke('main', 'query_resource_data_urls', {
            payload: { ...payload, resources: [resourceRef!] },
          })) as T.ResourceDataUrlBatchResult;
          expect(result.entries[0]!.dataUrl).toBeTruthy();
        }
    }
    const core = workspace.projects[0]!,
      skin = core.graph('skin', 'wolf_d_pirates').hull!;
    expect(skin.slots.some((slot) => ['WS 002', 'WS 003'].includes(String((slot as T.RowData).id)))).toBe(false);
    expect(skin.spec.hullName).toBe('野狼 (P)');
  });

  it('provides Core, three independent Mods, linked entities, all navigation entries and real hull slots', () => {
    const workspace = createBrowserWorkspace();
    expect(workspace.projects.map(({ manifest }) => manifest.modRoot)).toEqual([coreRoot, ...workspaceRoots]);
    expect(workspace.navigation).toEqual(buildModNavigationSections(workspace.projects[1]!.manifest).flatMap((section) => section.items));
    for (const project of workspace.projects.slice(1)) {
      const ship = [...project.entities.values()].find((entity) => entity.kind === 'ship')!;
      const variant = [...project.entities.values()].find((entity) => entity.kind === 'variant')!;
      expect(project.manifest.starsectorRoot).toBe(gameRoot);
      expect((ship.data as { weaponSlots: unknown[] }).weaponSlots.length).toBeGreaterThan(3);
      expect(
        workspace.projects.some((source) => source.entities.has(source.entityKey('ship', (variant.data as { hullId: string }).hullId))),
      ).toBe(true);
      expect(project.tables.get('ships')!.header).toContain('flux dissipation');
      expect(project.tables.get('weapons')!.header).toContain('damage/shot');
      expect(project.tables.get('ships')!.header).not.toEqual(project.tables.get('weapons')!.header);
      expect(project.tables.size).toBe(14);
    }
    expect(workspace.navigation).toHaveLength(23);
    expect(new Set(workspace.projects.map(({ manifest }) => manifest.sessionId)).size).toBe(4);
  });

  it('keeps query and save identity attached to the selected browser project', async () => {
    const workspace = createBrowserWorkspace();
    const main = workspace.projects[1]!;
    const other = workspace.projects[2]!;
    const entity = [...main.entities.values()].find((entry) => entry.kind === 'ship')!;
    const result = await workspace.invoke('main', 'query_entity', {
      payload: { sessionId: main.manifest.sessionId, kind: 'ship', id: entity.id },
    });
    expect(result).toMatchObject({ id: entity.id, target: { write: { root: main.manifest.modRoot } } });
    expect(workspace.calls.at(-1)).toMatchObject({ sessionId: main.manifest.sessionId });
    expect(other.entities.has(other.entityKey('ship', entity.id))).toBe(false);
    expect(other.manifest.modRoot).not.toBe(main.manifest.modRoot);
  });

  it('opens the same Core session when the path separator style differs', async () => {
    const workspace = createBrowserWorkspace();
    const manifest = (await workspace.invoke('main', 'open_project_session', {
      payload: { modRoot: gameRoot + '\\starsector-core' },
    })) as { modRoot: string; sessionId: string };
    expect(manifest).toMatchObject({ modRoot: gameRoot + '\\starsector-core', sessionId: workspace.projects[0]!.manifest.sessionId });
  });

  it('resolves a blank immersive root ID from the selected ship row key', async () => {
    const workspace = createBrowserWorkspace(),
      project = workspace.projects[1]!,
      row = project.tables.get('ships')!.rows.find((entry) => entry.data.id === 'Kratogen_tectogene')!;
    const snapshot = (await workspace.invoke('main', 'query_joint_edit', {
      payload: {
        root: { sessionId: project.manifest.sessionId, modRoot: project.manifest.modRoot, kind: 'ship', id: '' },
        rowKey: row.rowKey,
        values: null,
        newSources: [],
        catalog: null,
      },
    })) as { root: { kind: string; id: string } };
    expect(snapshot.root).toMatchObject({ kind: 'ship', id: 'Kratogen_tectogene' });
  });

  it('provides the variant list thumbnail from its referenced hull image', async () => {
    const workspace = createBrowserWorkspace(),
      project = workspace.projects[0]!,
      variant = [...project.entities.values()].find((entity) => entity.kind === 'variant')!;
    const result = (await workspace.invoke('main', 'query_entity_list', {
      payload: { sessionId: project.manifest.sessionId, kind: 'variant' },
    })) as T.EntityData[];
    expect(result.find((entity) => entity.id === variant.id)!.resourceRefs.sprite).toMatchObject({
      source: 'core',
      relPath: expect.stringMatching(/^graphics\/ships\//),
      ownerKind: 'variant',
      ownerId: variant.id,
      key: 'sprite',
    });
  });

  it('routes fixture appearance requests to the main settings owner', async () => {
    const workspace = createBrowserWorkspace();
    const child = (await workspace.openSampleWindow('file-editor')) as { label: string };
    const mainRequests: unknown[] = [];
    const childRequests: unknown[] = [];
    workspace.listen('main', 'browser-appearance-request', ({ payload }) => {
      mainRequests.push(payload);
    });
    workspace.listen(child.label, 'browser-appearance-request', ({ payload }) => {
      childRequests.push(payload);
    });
    await workspace.setAppearance({ theme: 'dark', accent: 'orange' });
    expect(mainRequests).toEqual([{ theme: 'dark', accent: 'orange' }]);
    expect(childRequests).toEqual([]);
  });

  it('captures close handshakes and restores a clean fixed workspace', async () => {
    const workspace = createBrowserWorkspace();
    workspace.state.mods[0]!.referenceable = true;
    const window = (await workspace.openSampleWindow('file-editor')) as { label: string };
    expect(workspace.windows.has(window.label)).toBe(true);
    workspace.restoreSample();
    expect([...workspace.windows.keys()]).toEqual(['main']);
    expect(workspace.state.mods.map((mod) => mod.referenceable)).toEqual([false, false, false]);
  });

  it('waits for each close reply and resumes a cancelled window', async () => {
    const workspace = createBrowserWorkspace();
    const child = (await workspace.openSampleWindow('file-editor')) as { label: string };
    const phases: string[] = [];
    workspace.listen(child.label, 'window-lifecycle-close-requested', async ({ payload }) => {
      const intent = payload as { operationId: number; phase: string };
      await Promise.resolve();
      phases.push(intent.phase);
      await workspace.invoke(child.label, 'reply_close', { ...intent, accepted: intent.phase !== 'confirm' });
    });
    expect(await workspace.invoke(child.label, 'request_close', { scope: { kind: 'window' } })).toMatchObject({
      status: 'cancelled',
      destroyedWindows: [],
    });
    expect(phases).toEqual(['hold', 'settle', 'prepare', 'confirm', 'resume']);
    expect(workspace.windows.has(child.label)).toBe(true);
  });

  it('writes and undoes an entity in its owning Mod session', () => {
    const project = createWorkspaceProject(workspaceRoots[0]!, 1);
    const ship = [...project.entities.values()].find((entry) => entry.kind === 'ship')!;
    const originalName = (ship.data as Record<string, unknown>).hullName;
    const changed = { ...(ship.data as Record<string, unknown>), hullName: 'Updated sample' };
    project.saveEntity(ship.target, changed);
    expect((project.entities.get(project.entityKey('ship', ship.id))!.data as Record<string, unknown>).hullName).toBe('Updated sample');
    project.undo();
    expect((project.entities.get(project.entityKey('ship', ship.id))!.data as Record<string, unknown>).hullName).toBe(originalName);
  });

  it('lists the receiver content before other sources and delivers all editor target identities', async () => {
    const workspace = createBrowserWorkspace(),
      receiver = workspace.projects[1]!;
    const entity = [...receiver.entities.values()].find(({ kind }) => kind === 'variant')!;
    entity.data = { ...(entity.data as Record<string, unknown>), displayName: 'Receiver variant' };
    const list = (await workspace.invoke('main', 'query_entity_list', {
      payload: { sessionId: receiver.manifest.sessionId, kind: 'variant' },
    })) as { id: string; data: { displayName: string } }[];
    expect(list.find(({ id }) => id === entity.id)!.data.displayName).toBe('Receiver variant');
    for (const kind of ['ship', 'weapon', 'projectile', 'system'] as const) {
      const window = (await workspace.openSampleWindow('editor', kind)) as { label: string };
      expect(workspace.windows.get(window.label)!.context!.identity).toMatchObject({
        type: 'spec',
        kind,
        sessionId: receiver.manifest.sessionId,
      });
    }
    for (const kind of ['ship', 'skin', 'weapon', 'wing', 'variant'] as const) {
      const window = (await workspace.openSampleWindow('immersive-editor', kind)) as { label: string };
      expect(workspace.windows.get(window.label)!.context!.identity).toMatchObject({
        type: 'immersive',
        kind,
        sessionId: kind === 'skin' ? workspace.projects[2]!.manifest.sessionId : receiver.manifest.sessionId,
      });
    }
  });

  it('isolates JSON document lists while reference catalogues retain enabled sources', async () => {
    const workspace = createBrowserWorkspace();
    await workspace.invoke('main', 'set_reference_sources', {
      sessionIds: workspace.projects.slice(1).map(({ manifest }) => manifest.sessionId),
    });
    for (const project of workspace.projects)
      for (const kind of ['faction', 'mission', 'skin', 'variant'] as const) {
        const list = (await workspace.invoke('main', 'query_entity_list', {
          payload: { sessionId: project.manifest.sessionId, kind },
        })) as T.EntityData[];
        expect(list.map(({ id }) => id).sort()).toEqual(
          [...project.entities.values()]
            .filter((entity) => entity.kind === kind)
            .map(({ id }) => id)
            .sort(),
        );
        expect(list.every(({ target }) => target.write.root === project.manifest.modRoot)).toBe(true);
      }
    const owner = workspace.projects[1]!;
    const catalogue = (await workspace.invoke('main', 'query_joint_edit', {
      payload: { root: owner.graph('variant').root, catalog: 'variants' },
    })) as T.JointVariantCatalogRead;
    expect(new Set(catalogue.catalog.entries.map(({ source }) => source.source))).toEqual(new Set(['mod', 'reference', 'core']));
  });

  it('renders and filters complete slot metadata while retaining raw IDs', async () => {
    const workspace = createBrowserWorkspace();
    const atlas = workspace.projects[1]!;
    const ship = [...atlas.entities.values()].find((entity) => entity.kind === 'ship')!;
    const response = (await workspace.invoke('main', 'query_hull_references', {
      payload: { sessionId: atlas.manifest.sessionId, referenceIds: [ship.id] },
    })) as { weaponSlots: Record<string, { id: string; type?: string; size?: string; mount?: string }[]> };
    const slots = (ship.data as { weaponSlots: { id: string; type: string; size: string; mount: string }[] }).weaponSlots.filter(
      (slot) => !['STATION_MODULE', 'DECORATIVE', 'SYSTEM'].includes(slot.type),
    );
    expect(response.weaponSlots[ship.id]).toEqual(
      slots.map(({ id, type, size, mount }) => expect.objectContaining({ id, type, size, mount })),
    );
  });
});
