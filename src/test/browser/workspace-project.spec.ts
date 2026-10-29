import { describe, expect, it } from 'vitest';
import { buildModNavigationSections } from '@/domain/workspace/mod-navigation';
import { createBrowserWorkspace } from './workspace-runtime';
import { createWorkspaceProject, coreRoot, gameRoot, workspaceRoots } from './workspace-project';

describe('complete browser workspace fixtures', () => {
  it('provides Core, three independent Mods, linked entities, all navigation entries and real hull slots', () => {
    const workspace = createBrowserWorkspace();
    expect(workspace.projects.map(({ manifest }) => manifest.modRoot)).toEqual([coreRoot, ...workspaceRoots]);
    expect(workspace.navigation).toEqual(buildModNavigationSections(workspace.projects[1]!.manifest).flatMap((section) => section.items));
    for (const project of workspace.projects.slice(1)) {
      const ship = [...project.entities.values()].find((entity) => entity.kind === 'ship')!;
      const variant = [...project.entities.values()].find((entity) => entity.kind === 'variant')!;
      expect(project.manifest.starsectorRoot).toBe(gameRoot);
      expect(project.slots.map(({ id, type, size, mount }) => [id, type, size, mount])).toEqual([
        ['WS001', 'BALLISTIC', 'SMALL', 'HARDPOINT'],
        ['WS002', 'ENERGY', 'MEDIUM', 'TURRET'],
        ['WS003', 'MISSILE', 'LARGE', 'HIDDEN'],
      ]);
      expect((ship.data as { weaponSlots: unknown[] }).weaponSlots).toHaveLength(3);
      expect((variant.data as { hullId: string }).hullId).toBe(ship.id);
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
    expect(other.entities.has(other.entityKey('ship', entity.id))).toBe(true);
    expect(other.manifest.modRoot).not.toBe(main.manifest.modRoot);
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
        sessionId: receiver.manifest.sessionId,
      });
    }
  });

  it('renders and filters complete slot metadata while retaining raw IDs', async () => {
    const workspace = createBrowserWorkspace();
    const atlas = workspace.projects[1]!;
    const response = (await workspace.invoke('main', 'query_hull_references', {
      payload: { sessionId: atlas.manifest.sessionId, referenceIds: ['lasher'] },
    })) as { weaponSlots: Record<string, { id: string; type?: string; size?: string; mount?: string }[]> };
    expect(response.weaponSlots.lasher).toEqual(atlas.slots.map((slot) => expect.objectContaining(slot)));
    expect(atlas.slots.map((slot) => [slot.id, slot.type, slot.size, slot.mount])).toContainEqual(['WS003', 'MISSILE', 'LARGE', 'HIDDEN']);
  });
});
