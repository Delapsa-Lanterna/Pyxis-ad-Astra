import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entityTargetFixture } from '@/test/entity-target';
import type { EntityData, ResourceRef, RowData } from '@/shared/types/index';
import { querySpecWeaponEditorData, querySpecWeaponEditorImages, querySpecWeaponProjectileOptions } from './spec-weapon-editor.service';

const mocks = vi.hoisted(() => ({ entity: vi.fn(), list: vi.fn(), resources: vi.fn(), images: vi.fn() }));
vi.mock('@/services/entity-query.service', () => ({
  querySessionEntity: mocks.entity,
  querySessionEntityList: mocks.list,
}));
vi.mock('@/services/resource-reference.service', () => ({
  querySessionDraftResources: mocks.resources,
}));
vi.mock('@/services/resource-media.service', () => ({ queryResourceDataUrls: mocks.images }));
beforeEach(() => vi.resetAllMocks());

function weaponRecord(spec: RowData, csvRow: RowData = {}): EntityData {
  const target = entityTargetFixture('weapon', 'railgun');
  return {
    target,
    baseVersions: [{ path: target.write.path, fingerprint: 'loaded' }],
    kind: 'weapon',
    id: 'railgun',
    data: { spec, csvRow },
    resourceRefs: {},
  };
}

describe('weapon editor queries', () => {
  it('returns an independent weapon spec with its actual target and loaded versions', async () => {
    const spec = { id: 'railgun', projectileSpecId: 'shot', custom: { size: 3 } };
    const record = weaponRecord(spec);
    mocks.entity.mockResolvedValue(record);
    const result = await querySpecWeaponEditorData('s1', 'railgun');
    expect(result).toEqual({ kind: 'weapon', spec, target: record.target, baseVersions: record.baseVersions, isNew: false });
    (result.spec.custom as { size: number }).size = 5;
    result.baseVersions[0]!.fingerprint = 'edit';
    expect(spec.custom.size).toBe(3);
    expect(record.baseVersions[0]!.fingerprint).toBe('loaded');
    expect(mocks.entity).toHaveBeenCalledExactlyOnceWith('s1', 'weapon', 'railgun', undefined);
  });
  it.each([
    ['beam', { 'beam speed': 1 }],
    ['projectile', {}],
  ] as const)('constructs a missing %s spec from its CSV classification', async (specClass, csvRow) => {
    mocks.entity.mockResolvedValue(weaponRecord({}, csvRow));
    const result = await querySpecWeaponEditorData('s1', 'railgun');
    expect(result).toMatchObject({ kind: 'weapon', isNew: true, spec: { id: 'railgun', specClass } });
  });
  it('preserves the missing weapon query diagnostic', async () => {
    mocks.entity.mockResolvedValue(null);
    await expect(querySpecWeaponEditorData('s1', 'ghost')).rejects.toThrow('找不到 ghost 的 weapon 数据');
  });
  it('reads the current projectile catalogue independently of the weapon spec', async () => {
    mocks.list.mockResolvedValueOnce([{ id: 'shot' }, { id: 'missile' }]);
    expect(await querySpecWeaponProjectileOptions('s1')).toEqual([
      { label: 'shot', value: 'shot' },
      { label: 'missile', value: 'missile' },
    ]);
    mocks.list.mockResolvedValueOnce([]);
    expect(await querySpecWeaponProjectileOptions('s1')).toEqual([]);
    expect(mocks.list).toHaveBeenCalledWith('s1', 'projectile', undefined);
  });
  it('resolves authorized images from the submitted weapon references', async () => {
    const draft = { id: 'railgun', turretSprite: 'graphics/draft.png' };
    const resource: ResourceRef = {
      source: 'mod',
      ownerKind: 'weapon',
      ownerId: 'railgun',
      key: 'turretSprite',
      relPath: 'graphics/draft.png',
    };
    mocks.resources.mockResolvedValue({ turretSprite: resource });
    mocks.images.mockResolvedValue(['data:image/png;base64,DRAFT']);
    const signal = new AbortController().signal;
    expect(await querySpecWeaponEditorImages('s1', 'railgun', draft, signal)).toEqual({
      resourceRefs: [resource],
      spriteData: { turretSprite: 'data:image/png;base64,DRAFT' },
    });
    expect(mocks.resources).toHaveBeenCalledExactlyOnceWith('s1', 'weapon', 'railgun', draft, signal);
    expect(mocks.images).toHaveBeenCalledExactlyOnceWith('s1', [resource], signal);
  });
});
