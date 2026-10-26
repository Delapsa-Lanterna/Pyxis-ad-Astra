import { describe, expect, it, vi, beforeEach } from 'vitest';
import { querySpecProjectileEditorData, querySpecProjectileEditorImages } from './spec-projectile-editor.service';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
const mocks = vi.hoisted(() => ({ entity: vi.fn(), target: vi.fn(), resources: vi.fn(), images: vi.fn() }));
vi.mock('@/services/entity-query.service', () => ({
  querySessionEntity: mocks.entity,
  querySessionEntityEditTarget: mocks.target,
}));
vi.mock('@/services/resource-reference.service', () => ({
  querySessionDraftResources: mocks.resources,
}));
vi.mock('@/services/resource-media.service', () => ({ queryResourceDataUrls: mocks.images }));
beforeEach(() => vi.resetAllMocks());
describe('projectile editor queries', () => {
  it('returns the saved projectile with independent spec and version data', async () => {
    const target = entityTargetFixture('projectile', 'p');
    const data = { id: 'p', specClass: 'missile', custom: { value: 3 } };
    const baseVersions = [{ path: target.write.path, fingerprint: 'read' }];
    mocks.entity.mockResolvedValueOnce({ target, data, baseVersions });
    const result = await querySpecProjectileEditorData('s1', 'p');
    expect(result).toEqual({ kind: 'projectile', target, spec: data, baseVersions, isNew: false });
    (result.spec.custom as { value: number }).value = 4;
    result.baseVersions[0]!.fingerprint = 'edit';
    expect(data.custom.value).toBe(3);
    expect(baseVersions[0]!.fingerprint).toBe('read');
  });
  it('creates missing specs at the officially returned create target', async () => {
    const target = entityTargetFixture('projectile', 'new', 'create');
    mocks.entity.mockResolvedValueOnce(null);
    mocks.target.mockResolvedValueOnce({ target, baseVersions: [] });
    const result = await querySpecProjectileEditorData('s1', 'new');
    expect(result).toMatchObject({ target, isNew: true, spec: { id: 'new', specClass: 'projectile', width: 3.5 } });
  });
  it('keeps a Core source with its Mod override write target', async () => {
    const target = entityTargetFixture('projectile', 'core', 'create');
    target.source = {
      source: 'core',
      root: 'M:/game',
      path: 'M:/game/data/weapons/proj/core.proj',
      relPath: 'data/weapons/proj/core.proj',
    };
    mocks.entity.mockResolvedValueOnce({ target, data: { id: 'core', width: 6 }, baseVersions: [] });
    expect(await querySpecProjectileEditorData('s1', 'core')).toMatchObject({ target, isNew: true, spec: { id: 'core', width: 6 } });
  });
});

describe('projectile draft images', () => {
  it.each([
    ['projectile', 'bulletSprite'],
    ['missile', 'sprite'],
  ])('loads %s images from their submitted draft and resource identity', async (kind, field) => {
    const ref = { source: 'mod', relPath: 'graphics/current.png', ownerKind: 'weapon', ownerId: 'p', key: field };
    const draft = { specClass: kind, [field]: ref.relPath };
    mocks.resources.mockResolvedValue({ [field]: ref, unused: { ...ref, key: 'unused' } });
    mocks.images.mockResolvedValue(['data:image/png;base64,CURRENT', 'data:image/png;base64,FX']);
    const signal = new AbortController().signal;
    expect(await querySpecProjectileEditorImages('s1', 'p', draft, signal)).toEqual({
      resourceRefs: [ref, { ...ref, key: 'unused' }],
      spriteData: { [field]: 'data:image/png;base64,CURRENT', unused: 'data:image/png;base64,FX' },
      diagnostic: '',
    });
    expect(mocks.resources).toHaveBeenCalledExactlyOnceWith('s1', 'projectile', 'p', draft, signal);
    expect(mocks.images).toHaveBeenCalledExactlyOnceWith('s1', [ref, { ...ref, key: 'unused' }], signal);
  });
  it('keeps an absent sprite distinct from an unresolved reference', async () => {
    mocks.resources.mockResolvedValueOnce({});
    mocks.images.mockResolvedValueOnce([]);
    expect(await querySpecProjectileEditorImages('s1', 'p', { specClass: 'projectile' })).toEqual({
      resourceRefs: [],
      spriteData: {},
      diagnostic: '',
    });
    mocks.resources.mockResolvedValueOnce({
      sprite: { source: 'mod', relPath: 'missing.png', ownerKind: 'weapon', ownerId: 'p', key: 'sprite' },
    });
    mocks.images.mockResolvedValueOnce([null]);
    expect(await querySpecProjectileEditorImages('s1', 'p', { specClass: 'missile', sprite: 'missing.png' })).toMatchObject({
      spriteData: { sprite: '' },
      diagnostic: '找不到贴图：missing.png',
    });
  });
});
