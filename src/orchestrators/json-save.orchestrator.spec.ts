import { savedWriteFixture } from '@/test/fixtures/write-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  writeModInfo: vi.fn(),
  writeIndexedConfigEntity: vi.fn(),
  writeCreateIndexedConfigEntity: vi.fn(),
  writeDeleteIndexedConfigEntity: vi.fn(),
  writeVariantEntity: vi.fn(),
  writeCreateVariantEntity: vi.fn(),
  writeDeleteVariantEntity: vi.fn(),
  writeSkinEntity: vi.fn(),
  writeCreateSkinEntity: vi.fn(),
  writeDeleteSkinEntity: vi.fn(),
}));

vi.mock('@/orchestrators/window-identity.orchestrator', () => ({
  reserveFileIdentityIntent: vi.fn(async () => {}),
}));
vi.mock('@/orchestrators/entity-write.orchestrator', () => ({
  chooseEntityFilename: vi.fn(async () => false),
}));
vi.mock('@/services/window.service', () => ({ releaseNativeWindowTargets: vi.fn(async () => {}) }));

vi.mock('@/services/json-entity.service', async () => ({
  ...(await vi.importActual('@/services/json-entity.service')),
  captureConfigIdentityIntent: async (_session: string, kind: import('@/shared/types').EntityKind, sourceId: string, nextId: string) => {
    const source = entityTargetFixture(kind, sourceId);
    const next = entityTargetFixture(kind, nextId);
    return {
      info: { target: source, baseVersions: [] },
      intent: { source, nextId, nextWrite: next.write, destinationVersion: { path: next.write.path, fingerprint: null } },
    };
  },
  saveModInfo: mocks.writeModInfo,
  saveIndexedConfigEntity: mocks.writeIndexedConfigEntity,
  createIndexedConfigEntity: mocks.writeCreateIndexedConfigEntity,
  deleteIndexedConfigEntity: mocks.writeDeleteIndexedConfigEntity,
}));
vi.mock('@/services/json-file.service', () => ({
  saveVariantEntity: mocks.writeVariantEntity,
  createVariantEntity: mocks.writeCreateVariantEntity,
  deleteVariantEntity: mocks.writeDeleteVariantEntity,
  saveSkinEntity: mocks.writeSkinEntity,
  createSkinEntity: mocks.writeCreateSkinEntity,
  deleteSkinEntity: mocks.writeDeleteSkinEntity,
}));

import {
  createIndexedEntityAction,
  createJsonFileAction,
  saveIndexedEntityAction,
  saveModInfoAction,
  saveJsonFileAction,
} from '@/orchestrators/json-save.orchestrator';
import { deleteJsonDocument } from '@/app/composables/json-editor/json-document-capabilities';
import { createDefaultVariant } from '@/domain/entity-write/spec-construction';

const MOD_ROOT = 'M:\\test-mod';
const SESSION_ID = 'sess-1';

function writeResult(refreshedEntity: Record<string, unknown> | null = null) {
  const kind = refreshedEntity?.variantId ? 'variant' : 'skin';
  const id = (refreshedEntity?.variantId ?? refreshedEntity?.skinHullId ?? '') as string;
  const target = entityTargetFixture(kind, id);
  return {
    ...savedWriteFixture(),
    changes: [
      {
        beforePath: `${MOD_ROOT}\\x.csv`,
        afterPath: `${MOD_ROOT}\\x.csv`,
        kind: 'file',
        beforeExists: true,
        beforeText: '',
        beforeDataBase64: null,
        beforeFiles: [],
        afterExists: true,
        afterText: '',
        afterDataBase64: null,
        afterFiles: [],
      },
    ],
    identityChanges: id ? [{ before: target, after: target }] : [],
    content: { target: { kind: 'json', origin: { kind: 'modInfo' } }, value: refreshedEntity },
    warnings: [],
  };
}

function indexedEntity(entityId: string) {
  return { entityId, indexPath: `${entityId}.csv`, indexHeader: ['id'], indexRows: [], entityData: null };
}

beforeEach(() => {
  setActivePinia(createPinia());
  for (const mock of Object.values(mocks)) mock.mockResolvedValue(writeResult());
});

describe('JSON save orchestrator', () => {
  it.each(['variant', 'skin'] as const)('preserves %s loaded credentials for same-ID and case-only writes', async (kind) => {
    const source = entityTargetFixture(kind, 'Demo');
    const baseVersions = [{ path: source.write.path, fingerprint: 'loaded-spec' }];
    const save = saveJsonFileAction;
    const write = kind === 'variant' ? mocks.writeVariantEntity : mocks.writeSkinEntity;
    const field = kind === 'variant' ? 'variantId' : 'skinHullId';
    for (const nextId of ['Demo', 'demo']) {
      write.mockResolvedValue(writeResult({ [field]: nextId, data: { [field]: nextId } }));
      await save(kind, SESSION_ID, MOD_ROOT, nextId, { [field]: nextId }, 'Demo', source.write.relPath, undefined, baseVersions);
      expect(write.mock.lastCall?.[0].baseVersions).toEqual(baseVersions);
    }
  });
  it('writes canonical mod info and synchronizes its captured receipt', async () => {
    mocks.writeModInfo.mockResolvedValue(writeResult());

    const result = await saveModInfoAction(SESSION_ID, MOD_ROOT, { id: 'demo' });

    expect(mocks.writeModInfo).toHaveBeenCalledWith(
      SESSION_ID,
      MOD_ROOT,
      { id: 'demo' },
      { preserveOriginalJson: false, confirmedSources: [] },
      [],
      undefined,
      undefined,
    );
    expect(result).toEqual(writeResult());
  });

  it('does not record file history when a preserved JSON save has no changes', async () => {
    mocks.writeModInfo.mockResolvedValue({ ...writeResult(), changes: [] });
    const result = await saveModInfoAction(SESSION_ID, MOD_ROOT, { id: 'demo' });
    expect(result!.changes).toEqual([]);
  });

  it('save indexed entity returns the refreshed entity id and records a save label', async () => {
    mocks.writeIndexedConfigEntity.mockResolvedValue(writeResult(indexedEntity('npc_dave')));

    const entityId = await saveIndexedEntityAction({
      baseVersions: [],
      sessionId: SESSION_ID,
      modRoot: MOD_ROOT,
      kind: 'faction',
      previousId: 'npc_dave',
      nextId: 'npc_dave',
      indexRow: {},
      entityData: {},
    });

    expect(entityId?.entity).toMatchObject({ entityId: 'npc_dave', baseVersions: [] });
    expect(entityId!.receipt).toEqual(writeResult(indexedEntity('npc_dave')));
  });

  it('create indexed entity delegates to the create write and records a create label', async () => {
    mocks.writeCreateIndexedConfigEntity.mockResolvedValue(writeResult(indexedEntity('mission_new')));

    const entityId = await createIndexedEntityAction({
      baseVersions: [],
      sessionId: SESSION_ID,
      modRoot: MOD_ROOT,
      kind: 'mission',
      previousId: null,
      nextId: 'mission_new',
      indexRow: {},
      entityData: {},
    });

    expect(entityId.entity.entityId).toBe('mission_new');
    expect(mocks.writeCreateIndexedConfigEntity).toHaveBeenCalledTimes(1);
    expect(mocks.writeIndexedConfigEntity).not.toHaveBeenCalled();
    expect(entityId.receipt).toEqual(writeResult(indexedEntity('mission_new')));
  });

  it('delete indexed entity forwards the delete target flag', async () => {
    mocks.writeDeleteIndexedConfigEntity.mockResolvedValue(writeResult(indexedEntity('npc_old')));

    await deleteJsonDocument({ sessionId: SESSION_ID, modRoot: MOD_ROOT, kind: 'faction', id: 'npc_old', entity: null }, [], true);

    expect(mocks.writeDeleteIndexedConfigEntity).toHaveBeenCalledWith(
      {
        baseVersions: [],
        sessionId: SESSION_ID,
        modRoot: MOD_ROOT,
        kind: 'faction',
        id: 'npc_old',
        deleteTarget: true,
      },
      undefined,
    );
  });

  it('variant create seeds the default variant payload', async () => {
    mocks.writeCreateVariantEntity.mockResolvedValue(
      writeResult({
        baseVersions: [],
        variantId: 'variant_new',
        hullId: 'npc_dave',
        path: 'data/variants/variant_new.variant',
        relPath: 'variants/variant_new.variant',
        data: {},
        weaponGroupCount: 0,
        hullModCount: 0,
        permaModCount: 0,
        wingCount: 0,
      }),
    );

    const variant = await createJsonFileAction('variant', SESSION_ID, MOD_ROOT, 'npc_dave', 'variant_new');

    expect(variant.entity.id).toBe('variant_new');
    const payload = mocks.writeCreateVariantEntity.mock.calls[0]![0];
    expect(payload.nextId).toBe('variant_new');
    expect(payload.data).toEqual(createDefaultVariant('npc_dave', 'variant_new'));
  });

  it('variant save forwards the previous id for renames', async () => {
    mocks.writeVariantEntity.mockResolvedValue(
      writeResult({
        baseVersions: [],
        variantId: 'variant_b',
        hullId: 'npc_dave',
        path: 'data/variants/variant_b.variant',
        relPath: 'variants/variant_b.variant',
        data: {},
        weaponGroupCount: 0,
        hullModCount: 0,
        permaModCount: 0,
        wingCount: 0,
      }),
    );

    await saveJsonFileAction(
      'variant',
      SESSION_ID,
      MOD_ROOT,
      'variant_b',
      { variantId: 'variant_b' },
      'variant_a',
      'data/variants/variant_a.variant',
    );

    expect(mocks.writeVariantEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVersions: [{ path: 'M:/mod/data/variants/variant_b.variant', fingerprint: null }],
        sessionId: SESSION_ID,
        modRoot: MOD_ROOT,
        previousId: 'variant_a',
        nextId: 'variant_b',
      }),
      { preserveOriginalJson: false, confirmedSources: [] },
      undefined,
      undefined,
    );
  });

  it('variant delete forwards the relative path', async () => {
    mocks.writeDeleteVariantEntity.mockResolvedValue(writeResult());

    const target = entityTargetFixture('variant', 'old');
    target.write.relPath = 'variants/old.variant';
    await deleteJsonDocument({ sessionId: SESSION_ID, modRoot: MOD_ROOT, kind: 'variant', id: 'old', entity: target }, [], true);

    expect(mocks.writeDeleteVariantEntity).toHaveBeenCalledWith(
      {
        baseVersions: [],
        sessionId: SESSION_ID,
        modRoot: MOD_ROOT,
        relPath: 'variants/old.variant',
        entityId: 'old',
      },
      undefined,
    );
  });

  it('skin create seeds the default skin payload', async () => {
    mocks.writeCreateSkinEntity.mockResolvedValue(
      writeResult({
        baseVersions: [],
        skinHullId: 'skin_new',
        baseHullId: 'npc_dave',
        path: 'data/hulls/skin_new.skin',
        relPath: 'skins/skin_new.skin',
        data: {},
        builtInModCount: 0,
        builtInWeaponCount: 0,
        builtInWingCount: 0,
        weaponSlotChangeCount: 0,
        engineSlotChangeCount: 0,
      }),
    );

    const skin = await createJsonFileAction('skin', SESSION_ID, MOD_ROOT, 'npc_dave', 'skin_new');

    expect(skin.entity.id).toBe('skin_new');
    expect(mocks.writeCreateSkinEntity).toHaveBeenCalledTimes(1);
  });

  it('skin save forwards the previous id', async () => {
    mocks.writeSkinEntity.mockResolvedValue(
      writeResult({
        baseVersions: [],
        skinHullId: 'skin_b',
        baseHullId: 'npc_dave',
        path: 'data/hulls/skin_b.skin',
        relPath: 'skins/skin_b.skin',
        data: {},
        builtInModCount: 0,
        builtInWeaponCount: 0,
        builtInWingCount: 0,
        weaponSlotChangeCount: 0,
        engineSlotChangeCount: 0,
      }),
    );

    await saveJsonFileAction('skin', SESSION_ID, MOD_ROOT, 'skin_b', { skinHullId: 'skin_b' }, 'skin_a', 'data/hulls/skins/skin_a.skin');

    expect(mocks.writeSkinEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVersions: [{ path: 'M:/mod/data/hulls/skins/skin_b.skin', fingerprint: null }],
        sessionId: SESSION_ID,
        modRoot: MOD_ROOT,
        previousId: 'skin_a',
        nextId: 'skin_b',
      }),
      { preserveOriginalJson: false, confirmedSources: [] },
      undefined,
      undefined,
    );
  });

  it('skin delete forwards the relative path', async () => {
    mocks.writeDeleteSkinEntity.mockResolvedValue(writeResult());

    const target = entityTargetFixture('skin', 'old');
    target.write.relPath = 'skins/old.skin';
    await deleteJsonDocument({ sessionId: SESSION_ID, modRoot: MOD_ROOT, kind: 'skin', id: 'old', entity: target }, [], true);

    expect(mocks.writeDeleteSkinEntity).toHaveBeenCalledWith(
      {
        baseVersions: [],
        sessionId: SESSION_ID,
        modRoot: MOD_ROOT,
        relPath: 'skins/old.skin',
        entityId: 'old',
      },
      undefined,
    );
  });
});
