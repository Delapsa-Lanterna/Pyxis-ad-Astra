import type { WriteResult, VariantFile, SkinFile } from '@/shared/types';
import type * as JsonEntityServiceModule from '@/services/json-entity.service';
import type * as JsonFileServiceModule from '@/services/json-file.service';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import { createPinia, setActivePinia } from 'pinia';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';

const mocks = vi.hoisted(() => ({
  writeModInfo: vi.fn<typeof JsonEntityServiceModule.saveModInfo>(),
  writeIndexedConfigEntity: vi.fn<typeof JsonEntityServiceModule.saveIndexedConfigEntity>(),
  writeCreateIndexedConfigEntity: vi.fn<typeof JsonEntityServiceModule.createIndexedConfigEntity>(),
  writeDeleteIndexedConfigEntity: vi.fn<typeof JsonEntityServiceModule.deleteIndexedConfigEntity>(),
  writeVariantEntity: vi.fn<typeof JsonFileServiceModule.saveVariantEntity>(),
  writeCreateVariantEntity: vi.fn<typeof JsonFileServiceModule.createVariantEntity>(),
  writeDeleteVariantEntity: vi.fn<typeof JsonFileServiceModule.deleteVariantEntity>(),
  writeSkinEntity: vi.fn<typeof JsonFileServiceModule.saveSkinEntity>(),
  writeCreateSkinEntity: vi.fn<typeof JsonFileServiceModule.createSkinEntity>(),
  writeDeleteSkinEntity: vi.fn<typeof JsonFileServiceModule.deleteSkinEntity>(),
}));

vi.mock('@/orchestrators/window-identity.orchestrator', () => ({
  reserveFileIdentityIntent: vi.fn(async () => {}),
}));
vi.mock('@/services/window.service', () => ({ releaseNativeWindowTargets: vi.fn(async () => {}) }));

vi.mock('@/services/json-entity.service', async () => ({
  ...(await vi.importActual('@/services/json-entity.service')),
  captureConfigIdentityIntent: async (_session: string, kind: EntityKind, sourceId: string, nextId: string) => {
    const source = entityTargetFixture(kind, sourceId);
    const next = entityTargetFixture(kind, nextId);
    return {
      snapshot: { target: source, baseVersions: [] },
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
import type { AppFeedback, RowData, EntityKind } from '@/shared/types';

const MOD_ROOT = 'M:\\test-mod';
const SESSION_ID = 'sess-1';

function writeResult<T extends RowData = never>(refreshedEntity: T | null = null): WriteResult<T> {
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
    content: refreshedEntity === null ? null : { target: { kind: 'json', origin: { kind: 'modInfo' } }, value: refreshedEntity },
  };
}

const variantFile: VariantFile = {
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
};
const skinFile: SkinFile = {
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
};
function indexedEntity(entityId: string) {
  return { entityId, indexPath: `${entityId}.csv`, indexHeader: ['id'], indexRows: [], entityData: null };
}

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  vi.clearAllMocks();
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
      if (kind === 'variant')
        mocks.writeVariantEntity.mockResolvedValue(writeResult({ ...variantFile, variantId: nextId, data: { variantId: nextId } }));
      else mocks.writeSkinEntity.mockResolvedValue(writeResult({ ...skinFile, skinHullId: nextId, data: { skinHullId: nextId } }));
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
        ...variantFile,
        variantId: 'variant_new',
        path: 'data/variants/variant_new.variant',
        relPath: 'variants/variant_new.variant',
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
        ...variantFile,
        variantId: 'variant_b',
        path: 'data/variants/variant_b.variant',
        relPath: 'variants/variant_b.variant',
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
      writeResult({ ...skinFile, skinHullId: 'skin_new', path: 'data/hulls/skin_new.skin', relPath: 'skins/skin_new.skin' }),
    );

    const skin = await createJsonFileAction('skin', SESSION_ID, MOD_ROOT, 'npc_dave', 'skin_new');

    expect(skin.entity.id).toBe('skin_new');
    expect(mocks.writeCreateSkinEntity).toHaveBeenCalledTimes(1);
  });

  it('skin save forwards the previous id', async () => {
    mocks.writeSkinEntity.mockResolvedValue(
      writeResult({ ...skinFile, skinHullId: 'skin_b', path: 'data/hulls/skin_b.skin', relPath: 'skins/skin_b.skin' }),
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

describe('JSON local identity presence', () => {
  it.each([
    [false, false],
    [true, true],
    [false, true],
    [true, false],
  ])('saves local presence %s -> %s', async (beforeId, afterId) => {
    const choose = vi.fn<AppFeedback['choose']>(async () => 'save');
    const feedback = { choose } as Pick<AppFeedback, 'choose'> as AppFeedback;
    const before: RowData = beforeId ? { skinHullId: 'sample' } : {};
    const after: RowData = afterId ? { skinHullId: 'sample' } : {};
    const target = entityTargetFixture('skin', 'sample');
    mocks.writeSkinEntity.mockResolvedValue(writeResult({ ...skinFile, skinHullId: 'sample', data: after }));
    const save = () =>
      saveJsonFileAction('skin', SESSION_ID, MOD_ROOT, 'sample', after, 'sample', target.write.relPath, feedback, [], before);
    expect(await save()).not.toBeNull();
    expect(choose).toHaveBeenCalledTimes(Number(beforeId !== afterId));
    expect(mocks.writeSkinEntity.mock.lastCall![0].data).toEqual(after);
    if (beforeId !== afterId) {
      choose.mockResolvedValueOnce('cancel');
      const count = mocks.writeSkinEntity.mock.calls.length;
      expect(await save()).toBeNull();
      expect(mocks.writeSkinEntity).toHaveBeenCalledTimes(count);
    }
  });
});
