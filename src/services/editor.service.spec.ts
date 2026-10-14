import { entityTargetFixture } from '@/test/entity-target';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityData, ResourceRef, RowData, WriteResult } from '@/shared/types';
import { shipJointFixture } from '@/test/joint-edit';
import { weaponJointFixture } from '@/test/weapon-joint-edit';

const mocks = vi.hoisted(() => ({
  querySessionEntity: vi.fn(),
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
  queryShipEditorData,
  querySystemEditorData,
  queryShipEditorImages,
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

describe('ship and system edit queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an existing ship with its loaded target', async () => {
    const spriteRef: ResourceRef = { key: 'sprite', source: 'mod', relPath: 'graphics/ship.png', ownerKind: 'ship', ownerId: 'XY' };
    mocks.querySessionEntity.mockResolvedValue(entity({ hullId: 'XY' }, { sprite: spriteRef }));

    const bundle = await queryShipEditorData('s1', 'XY');
    expect(bundle).toMatchObject({ kind: 'ship', isNew: false });
    expect(bundle.kind === 'ship' && bundle.spec).toEqual({ hullId: 'XY' });
    expect(bundle.target).toEqual(entity({}).target);
  });

  it('marks a missing ship as new and falls back to the default spec', async () => {
    mocks.querySessionEntity.mockResolvedValue(null);
    const bundle = await queryShipEditorData('s1', 'XY');
    expect(bundle.kind === 'ship' && bundle.isNew).toBe(true);
    expect(bundle.kind === 'ship' && bundle.spec.hullId).toBe('XY');
  });

  it('creates a missing system with its default stat modifier branch', async () => {
    mocks.querySessionEntity.mockResolvedValueOnce(null);
    const missingSystem = await querySystemEditorData('s1', 's1');
    expect(missingSystem.kind === 'system' && missingSystem.isNew).toBe(true);
    expect(missingSystem.kind === 'system' && missingSystem.spec.type).toBe('STAT_MOD');
  });
});

describe('editor dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries ship images from the submitted draft reference', async () => {
    const sprite: ResourceRef = { key: 'sprite', source: 'mod', relPath: 'graphics/ship.png', ownerKind: 'ship', ownerId: 'XY' };
    mocks.querySessionEditorDraftResources.mockResolvedValueOnce({ sprite });
    mocks.queryResourceDataUrls.mockResolvedValueOnce(['data:image/png;base64,BBB']);
    const data = await queryShipEditorImages('s1', 'XY', { hullId: 'XY', spriteName: 'graphics/ship.png' });
    expect(data).toEqual({ resourceRefs: [sprite], spriteData: 'data:image/png;base64,BBB', diagnostic: '' });
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
});
