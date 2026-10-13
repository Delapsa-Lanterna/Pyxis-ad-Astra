import { entityTargetFixture } from '@/test/entity-target';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityData, ResourceRef, RowData } from '@/shared/types';

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

import { queryWeaponFirePreviewData } from './weapon-fire-preview.service';

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

describe('weapon fire preview queries', () => {
  beforeEach(() => vi.clearAllMocks());
  it('loads preview dependencies from the current draft weapon reference', async () => {
    mocks.querySessionEntity.mockImplementation(async (_sessionId: string, kind: string, id: string) => {
      if (kind === 'weapon') {
        return entity(
          { id, spec: { id, projectileSpecId: 'proj_a', turretSprite: 'graphics/a.png' }, csvRow: { id } },
          {
            turretSprite: { source: 'mod', relPath: 'graphics/saved.png', ownerKind: 'weapon', ownerId: id, key: 'turretSprite' },
          },
        );
      }
      if (kind === 'projectile' && id === 'proj_b') return entity({ id, specClass: 'projectile', length: 42 }, {});
      if (kind === 'projectile' && id === 'proj_a') return entity({ id, specClass: 'projectile', length: 10 }, {});
      return null;
    });
    mocks.queryResourceDataUrls.mockResolvedValue(['data:image/png;base64,DRAFT']);
    mocks.querySessionEditorDraftResources.mockResolvedValue({
      turretSprite: { source: 'mod', relPath: 'graphics/draft.png', ownerKind: 'weapon', ownerId: 'railgun', key: 'turretSprite' },
    });

    const bundle = await queryWeaponFirePreviewData('s1', 'railgun', {
      kind: 'draft',
      weapon: {
        id: 'railgun',
        projectileSpecId: 'proj_b',
        turretSprite: 'graphics/draft.png',
      },
    });

    expect(bundle.weapon.projectileSpecId).toBe('proj_b');
    expect(bundle.projectileSpecs).toEqual({ proj_b: { id: 'proj_b', specClass: 'projectile', length: 42 } });
    expect(bundle.weaponSpriteData).toEqual({ turretSprite: 'data:image/png;base64,DRAFT' });
    expect(mocks.querySessionEditorDraftResources).toHaveBeenCalledWith(
      's1',
      'weapon',
      'railgun',
      {
        id: 'railgun',
        projectileSpecId: 'proj_b',
        turretSprite: 'graphics/draft.png',
      },
      undefined,
    );
    expect(mocks.queryResourceDataUrls).toHaveBeenCalledTimes(1);
  });

  it('reports a missing draft projectile as a preview query error', async () => {
    mocks.querySessionEntity.mockImplementation(async (_sessionId: string, kind: string, id: string) =>
      kind === 'weapon' ? entity({ id, spec: { id, projectileSpecId: 'saved' }, csvRow: { id } }) : null,
    );
    await expect(
      queryWeaponFirePreviewData('s1', 'railgun', { kind: 'draft', weapon: { id: 'railgun', projectileSpecId: 'missing' } }),
    ).rejects.toThrow('找不到预览弹体 missing');
  });
});
