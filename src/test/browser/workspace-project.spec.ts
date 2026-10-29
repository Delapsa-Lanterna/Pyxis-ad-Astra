import { describe, expect, it } from 'vitest';
import type * as T from '@/shared/types';
import { gameImages } from './game-files';
import { formatModVersion } from '@/shared/lib/starsector';
import { buildModNavigationSections } from '@/domain/workspace/mod-navigation';
import { createBrowserWorkspace } from './workspace-runtime';
import { createWorkspaceProject, coreRoot, gameRoot, workspaceRoots } from './workspace-project';

describe('complete browser workspace fixtures', () => {
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
