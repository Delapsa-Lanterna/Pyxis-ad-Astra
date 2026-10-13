import { entityTargetFixture } from '@/test/entity-target';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWeaponSpec } from '@/domain/editors/spec-construction';
import { inferWeaponSpecClass } from '@/domain/tables/associated-spec-creation';
import type { EntityData, ResourceRef, RowData, WriteResult } from '@/shared/types';
import { shipJointFixture } from '@/test/joint-edit';
import { weaponJointFixture } from '@/test/weapon-joint-edit';

const mocks = vi.hoisted(() => ({
  querySessionEntity: vi.fn(),
  querySessionEntityList: vi.fn(async () => [] as { id: string }[]),
  querySessionEditorDraftResources: vi.fn(async () => ({})),
  queryResourceDataUrls: vi.fn(async () => [] as (string | null)[]),
  invokeCommand: vi.fn(),
  queryJointCandidate: vi.fn(),
}));

vi.mock('@/services/entity-query.service', () => ({
  querySessionEntityEditTarget: vi.fn(async (_session: string, kind: import('@/shared/types').EntityKind, id: string) => ({
    target: entityTargetFixture(kind, id, 'create'),
    baseVersions: [],
  })),
  querySessionEntity: mocks.querySessionEntity,
  querySessionEntityList: mocks.querySessionEntityList,
  querySessionEditorDraftResources: mocks.querySessionEditorDraftResources,
}));

vi.mock('@/services/resource-cache.service', () => ({
  queryResourceDataUrls: mocks.queryResourceDataUrls,
}));

vi.mock('@/shared/runtime/command.runtime', () => ({
  invokeCommand: mocks.invokeCommand,
}));
vi.mock('@/services/joint-edit.service', () => ({ queryJointCandidate: mocks.queryJointCandidate }));

import { editorMissingTargetText, isEditorWindowKind } from '@/domain/editors/editor-definitions';
import {
  queryEditorEntityBundle,
  refreshBundleProjectiles,
  refreshBundleResources,
  saveEditorSpecByKind,
  loadImportedSpecFile,
  queryShipWeaponSources,
} from './editor.service';

function entity(data: RowData, refs: Record<string, ResourceRef> = {}): EntityData {
  return {
    target: entityTargetFixture('ship', 'loaded'),
    baseVersions: [],
    kind: 'ship',
    id: String(data.id ?? ''),
    data,
    resourceRefs: refs,
  };
}

function writeResultFixture(): WriteResult {
  return {
    sessionUpdates: [],
    baseVersions: [],
    commitId: 1,
    history: { revision: 1, undoStack: [], redoStack: [] },
    changes: [],
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    identityChanges: [],
    keyMap: [],
    refreshedEntity: null,
  };
}

describe('ship built-in source reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('deduplicates weapon IDs and retains Core resources, projectile data and CSV hints', async () => {
    const hull = shipJointFixture(),
      weapon = weaponJointFixture();
    hull.records[1]!.value = { state: 'present', value: { hints: 'WEAPONS_FRONT_TO_BACK, CIVILIAN' } };
    const sprite: ResourceRef = {
      key: 'turretSprite',
      source: 'core',
      relPath: 'graphics/weapon.png',
      ownerKind: 'weapon',
      ownerId: 'chaingun',
    };
    weapon.records[0]!.resourceRefs = { turretSprite: sprite };
    mocks.queryJointCandidate.mockImplementation(async (root: import('@/shared/types').JointEditRoot) =>
      root.kind === 'ship' ? hull : weapon,
    );
    const signal = new AbortController().signal;
    const read = await queryShipWeaponSources(hull.root, { builtInWeapons: { A: 'chaingun', B: 'chaingun' } }, signal);
    expect(mocks.queryJointCandidate).toHaveBeenCalledTimes(2);
    expect(mocks.queryJointCandidate).toHaveBeenCalledWith({ ...hull.root, kind: 'weapon', id: 'chaingun' }, signal);
    expect(read.hints).toEqual(['WEAPONS_FRONT_TO_BACK', 'CIVILIAN']);
    expect(read.weapons.chaingun).toMatchObject({
      spec: { id: 'chaingun', size: 'MEDIUM' },
      resources: { turretSprite: sprite },
      projectile: { id: 'chaingun_shot' },
    });
  });
  it('returns per-weapon failures alongside available equipment and missing records', async () => {
    mocks.queryJointCandidate.mockImplementation(async (root: import('@/shared/types').JointEditRoot) => {
      if (root.kind === 'ship') return shipJointFixture();
      if (root.id === 'broken') throw new Error('规格格式错误');
      const snapshot = weaponJointFixture();
      if (root.id === 'missing') snapshot.records[0]!.value = { state: 'missing' };
      return snapshot;
    });
    const read = await queryShipWeaponSources(shipJointFixture().root, { builtInWeapons: { A: 'good', B: 'broken', C: 'missing' } });
    expect(read.weapons.good!.spec).toMatchObject({ id: 'chaingun' });
    expect(read.weapons.broken).toMatchObject({ spec: null, diagnostic: expect.stringContaining('规格格式错误') });
    expect(read.weapons.missing!.spec).toBeNull();
  });
});

describe('queryEditorEntityBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads a ship bundle with its sprite and isNew=false for existing specs', async () => {
    const spriteRef: ResourceRef = { key: 'sprite', source: 'mod', relPath: 'graphics/ship.png', ownerKind: 'ship', ownerId: 'XY' };
    mocks.querySessionEntity.mockResolvedValue(entity({ hullId: 'XY' }, { sprite: spriteRef }));
    mocks.queryResourceDataUrls.mockResolvedValue(['data:image/png;base64,AAA']);

    const bundle = await queryEditorEntityBundle('s1', 'ship', 'XY');
    expect(bundle).toMatchObject({ kind: 'ship', isNew: false, shipSpriteData: 'data:image/png;base64,AAA' });
    expect(bundle.kind === 'ship' && bundle.ship).toEqual({ hullId: 'XY' });
    expect(bundle.kind === 'ship' && bundle.resourceRefs).toEqual([spriteRef]);
  });

  it('marks a missing ship as new and falls back to the default spec', async () => {
    mocks.querySessionEntity.mockResolvedValue(null);
    const bundle = await queryEditorEntityBundle('s1', 'ship', 'XY');
    expect(bundle.kind === 'ship' && bundle.isNew).toBe(true);
    expect(bundle.kind === 'ship' && bundle.ship.hullId).toBe('XY');
    expect(bundle.kind === 'ship' && bundle.shipSpriteData).toBe('');
  });

  it('loads a weapon bundle with csv row, projectile spec and options', async () => {
    mocks.querySessionEntity.mockImplementation(async (_sessionId: string, kind: string, id: string) => {
      if (kind === 'weapon') return entity({ id, spec: { id, projectileSpecId: 'proj1' }, csvRow: { id: 'railgun' } }, {});
      if (kind === 'projectile') return entity({ id: 'proj1' }, {});
      return null;
    });
    mocks.querySessionEntityList.mockResolvedValue([{ id: 'proj1' }, { id: 'proj2' }]);

    const bundle = await queryEditorEntityBundle('s1', 'weapon', 'railgun');
    expect(bundle.kind).toBe('weapon');
    if (bundle.kind !== 'weapon') return;
    expect(bundle.weapon).toEqual({ id: 'railgun', projectileSpecId: 'proj1' });
    expect(bundle.weaponCsvRow).toEqual({ id: 'railgun' });
    expect(bundle.isNew).toBe(false);
    expect(bundle.projectileSpecs).toHaveProperty('proj1');
    expect(bundle.projectileOptions).toEqual([
      { label: 'proj1', value: 'proj1' },
      { label: 'proj2', value: 'proj2' },
    ]);
  });

  it('rejects weapon queries without entity data', async () => {
    mocks.querySessionEntity.mockResolvedValue(null);
    await expect(queryEditorEntityBundle('s1', 'weapon', 'ghost')).rejects.toThrow('找不到 ghost 的 weapon 数据');
  });

  it('treats a weapon spec without fields as new', async () => {
    mocks.querySessionEntity.mockResolvedValue(entity({ id: 'w', spec: {}, csvRow: {} }, {}));
    const bundle = await queryEditorEntityBundle('s1', 'weapon', 'w');
    expect(bundle.kind === 'weapon' && bundle.isNew).toBe(true);
  });

  it('loads projectile and system bundles with new flags', async () => {
    mocks.querySessionEntity.mockResolvedValueOnce(entity({ id: 'p1' }));
    const projectile = await queryEditorEntityBundle('s1', 'projectile', 'p1');
    expect(projectile.kind === 'projectile' && projectile.isNew).toBe(false);

    mocks.querySessionEntity.mockResolvedValueOnce(null);
    const missingSystem = await queryEditorEntityBundle('s1', 'system', 's1');
    expect(missingSystem.kind === 'system' && missingSystem.isNew).toBe(true);
    expect(missingSystem.kind === 'system' && missingSystem.system.type).toBe('STAT_MOD');
  });
});

describe('bundle refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes the ship sprite data from the sprite resource ref', async () => {
    const spriteRef: ResourceRef = { key: 'sprite', source: 'mod', relPath: 'graphics/ship.png', ownerKind: 'ship', ownerId: 'XY' };
    mocks.querySessionEntity.mockResolvedValue(entity({ hullId: 'XY' }, { sprite: spriteRef }));
    mocks.queryResourceDataUrls.mockResolvedValue(['data:image/png;base64,BBB']);
    const bundle = await queryEditorEntityBundle('s1', 'ship', 'XY');
    const refreshed = await refreshBundleResources('s1', bundle);
    expect(refreshed.kind === 'ship' && refreshed.shipSpriteData).toBe('data:image/png;base64,BBB');
  });

  it('refreshes weapon projectile specs and drops vanished projectiles', async () => {
    mocks.querySessionEntity.mockImplementation(async (_sessionId: string, kind: string, id: string) => {
      if (kind === 'weapon') return entity({ id, spec: { id, projectileSpecId: 'proj1' }, csvRow: {} }, {});
      if (id === 'proj1') return entity({ id: 'proj1', updated: true }, {});
      return null;
    });
    const bundle = await queryEditorEntityBundle('s1', 'weapon', 'railgun');
    const refreshed = await refreshBundleProjectiles('s1', bundle, { projectileSpecs: true, projectileOptions: false });
    expect(refreshed.kind === 'weapon' && refreshed.projectileSpecs.proj1).toEqual({ id: 'proj1', updated: true });

    mocks.querySessionEntity.mockImplementation(async () => null);
    const emptied = await refreshBundleProjectiles('s1', refreshed, { projectileSpecs: true, projectileOptions: false });
    expect(emptied.kind === 'weapon' && emptied.projectileSpecs).toEqual({});
  });

  it('loads projectile dependencies from the current weapon reference', async () => {
    mocks.querySessionEntity.mockImplementation(async (_session: string, kind: string, id: string) =>
      kind === 'weapon' ? entity({ id, spec: { id, projectileSpecId: 'old' }, csvRow: {} }) : entity({ id }),
    );
    const loaded = await queryEditorEntityBundle('s1', 'weapon', 'weapon');
    if (loaded.kind !== 'weapon') throw new Error('weapon bundle expected');
    const refreshed = await refreshBundleProjectiles(
      's1',
      { ...loaded, weapon: { ...loaded.weapon, projectileSpecId: 'next' } },
      { projectileSpecs: true, projectileOptions: false },
    );
    expect(refreshed.kind === 'weapon' && refreshed.projectileSpecs).toEqual({ next: { id: 'next' } });
  });

  it('leaves projectile and system bundles untouched by resource refresh', async () => {
    mocks.querySessionEntity.mockResolvedValue(entity({ id: 'p1' }));
    const bundle = await queryEditorEntityBundle('s1', 'projectile', 'p1');
    await expect(refreshBundleResources('s1', bundle)).resolves.toBe(bundle);
  });
});

describe('saveEditorSpecByKind and import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps write failures with the spec save cause', async () => {
    mocks.invokeCommand.mockRejectedValue(new Error('disk on fire'));
    await expect(saveEditorSpecByKind('s1', 'C:/mods/alpha', entityTargetFixture('ship', 'XY'), { hullId: 'XY' })).rejects.toThrow(
      '保存 XY spec 失败',
    );
    expect(mocks.invokeCommand).toHaveBeenCalledWith('save_editor_spec', {
      payload: {
        baseVersions: [],
        sessionId: 's1',
        modRoot: 'C:/mods/alpha',
        target: entityTargetFixture('ship', 'XY'),
        data: { hullId: 'XY' },
      },
    });
  });

  it('passes successful writes through unchanged', async () => {
    const result = writeResultFixture();
    result.refreshedEntity = { id: 'S1' };
    mocks.invokeCommand.mockResolvedValue(result);
    await expect(saveEditorSpecByKind('s1', 'C:/mods/alpha', entityTargetFixture('system', 'S1'), { id: 'S1' })).resolves.toEqual(result);
  });

  it('rejects saves without a mod root or id before touching the writer', async () => {
    await expect(saveEditorSpecByKind('s1', '', entityTargetFixture('ship', 'XY'), {})).rejects.toMatchObject({ action: 'save-spec' });
    await expect(saveEditorSpecByKind('s1', 'C:/mods/alpha', entityTargetFixture('ship', ''), {})).rejects.toMatchObject({
      action: 'save-spec',
    });
    expect(mocks.invokeCommand).not.toHaveBeenCalled();
  });

  it('delegates imported spec file loads', async () => {
    mocks.invokeCommand.mockResolvedValue({ id: 'imported' });
    await expect(loadImportedSpecFile('ship', 'C:/temp/x.ship')).resolves.toEqual({ id: 'imported' });
    expect(mocks.invokeCommand).toHaveBeenCalledWith('load_imported_editor_spec_file', {
      payload: { kind: 'ship', path: 'C:/temp/x.ship' },
    });
  });
});

describe('editor definitions helpers', () => {
  it('recognizes window kinds and reports missing target text', () => {
    expect(isEditorWindowKind('ship')).toBe(true);
    expect(isEditorWindowKind('weapon')).toBe(true);
    expect(isEditorWindowKind('not-a-kind')).toBe(false);
    expect(isEditorWindowKind(null)).toBe(false);
    expect(editorMissingTargetText('ship', 'XY')).toContain('spec');
  });

  it('builds a beam weapon default when the csv row declares beam speed', () => {
    const beam = createWeaponSpec('laser', inferWeaponSpecClass({ 'beam speed': 1 }));
    expect(beam.specClass).toBe('beam');
    expect(beam.fringeColor).toBeDefined();
    const projectile = createWeaponSpec('cannon', inferWeaponSpecClass({}));
    expect(projectile.specClass).toBe('projectile');
  });
});
