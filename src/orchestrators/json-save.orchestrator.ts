import { recreateJsonSources } from '@/services/json-recovery.service';
import type { AppFeedback, SavedConfig, IndexedConfigKind, JsonEntityFile, WriteResult, RowData } from '@/shared/types';

import {
  createIndexedConfigEntity,
  deleteIndexedConfigEntity,
  saveIndexedConfigEntity,
  saveModInfo,
  captureConfigIdentityIntent,
} from '@/services/json-entity.service';
import {
  createSkinEntity,
  createVariantEntity,
  deleteSkinEntity,
  deleteVariantEntity,
  saveSkinEntity,
  saveVariantEntity,
} from '@/services/json-file.service';
import { createDefaultSkin, createDefaultVariant } from '@/domain/json-editor/json-file-defaults';
import { indexedConfigEntityData } from '@/domain/json-editor/json-config-records';
import { jsonEntitySavedData } from '@/domain/json-editor/json-file-records';
import { completeSavedWrite, retryPendingModSyncs } from '@/orchestrators/project-sync.orchestrator';

import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';

import { reserveFileIdentityIntent } from '@/orchestrators/entity-identity.orchestrator';
import { focusEntityIdentityConflict } from '@/orchestrators/window-target-focus.orchestrator';
import { releaseNativeWindowTargets } from '@/services/window.service';
import { captureIdentityVersions } from '@/domain/project/entity-versions';
import { withEditTargetHandoff } from '@/orchestrators/edit-target-handoff.orchestrator';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { normalizeFsPath } from '@/shared/lib/paths';
const variantHandoffs = new Map<number, () => Promise<void>>();

async function capturedVersions(
  sessionId: string,
  modRoot: string,
  kind: import('@/shared/types').EntityKind,
  sourceId: string,
  nextId: string,
  baseVersions: import('@/shared/types').FileVersion[],
  create = false,
) {
  await retryPendingModSyncs(modRoot);
  const captured = await captureConfigIdentityIntent(sessionId, kind, sourceId, nextId).catch(async (error) => {
    await focusEntityIdentityConflict(sessionId, modRoot, error);
    throw error;
  });
  await reserveFileIdentityIntent(sessionId, modRoot, captured.intent);
  const versions = create ? captured.info.baseVersions : baseVersions;
  return captureIdentityVersions(versions, captured.intent.destinationVersion);
}

async function retainConfigReservation<T>(write: Promise<T>): Promise<T> {
  try {
    const result = await write;
    if (result === null) await releaseNativeWindowTargets();
    return result;
  } catch (error) {
    await releaseNativeWindowTargets();
    throw error;
  }
}

export async function saveModInfoAction(
  sessionId: string,
  modRoot: string,
  data: RowData,
  feedback?: AppFeedback,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult | null> {
  await retryPendingModSyncs(modRoot);
  const result = await runConfirmedJsonWrite(feedback, (options) => saveModInfo(sessionId, modRoot, data, options, baseVersions));
  if (!result) return null;
  return result;
}

export async function saveIndexedEntityAction(
  write: {
    baseVersions: import('@/shared/types').FileVersion[];
    sessionId: string;
    modRoot: string;
    kind: IndexedConfigKind;
    previousId: string | null;
    nextId: string;
    indexRow: RowData;
    entityData: RowData;
  },
  feedback?: AppFeedback,
): Promise<SavedConfig<import('@/shared/types').IndexedConfigEntityData> | null> {
  const versions = await capturedVersions(
    write.sessionId,
    write.modRoot,
    write.kind,
    write.previousId ?? write.nextId,
    write.nextId,
    write.baseVersions,
  );
  const result = await retainConfigReservation(
    runConfirmedJsonWrite(feedback, (options) => saveIndexedConfigEntity({ ...write, baseVersions: versions }, options)),
  );
  if (!result) return null;
  const entity = indexedConfigEntityData(result);
  return { entity, receipt: result };
}

export async function createIndexedEntityAction(write: {
  baseVersions: import('@/shared/types').FileVersion[];
  sessionId: string;
  modRoot: string;
  kind: IndexedConfigKind;
  previousId: null;
  nextId: string;
  indexRow: RowData;
  entityData: RowData;
}): Promise<SavedConfig<import('@/shared/types').IndexedConfigEntityData>> {
  const baseVersions = await capturedVersions(write.sessionId, write.modRoot, write.kind, write.nextId, write.nextId, [], true);
  const result = await retainConfigReservation(createIndexedConfigEntity({ ...write, baseVersions }));
  const entity = indexedConfigEntityData(result);
  return { entity, receipt: result };
}

export async function deleteIndexedEntityAction(
  sessionId: string,
  modRoot: string,
  kind: IndexedConfigKind,
  id: string,
  deleteTarget: boolean,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  const result = await deleteIndexedConfigEntity({ sessionId, modRoot, kind, id, deleteTarget, baseVersions });
  return result;
}

export async function saveVariantAction(
  sessionId: string,
  modRoot: string,
  variantId: string,
  data: RowData,
  previousId: string | null,
  relPath: string,
  feedback?: AppFeedback,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<SavedConfig<JsonEntityFile> | null> {
  const sourceId = previousId ?? variantId;
  const targetKey = JSON.stringify({ sessionId, modRoot, kind: 'variant', id: sourceId, relPath });
  let release: (() => Promise<void>) | null = null;
  const save = async () => {
    const captured = await captureConfigIdentityIntent(sessionId, 'variant', sourceId, variantId);
    const parentVersions = captured.info.baseVersions.filter(
      (version) => normalizeFsPath(version.path) !== normalizeFsPath(captured.info.target.write.path),
    );
    const versions = baseVersions.filter(
      (version) => !parentVersions.some((parent) => normalizeFsPath(parent.path) === normalizeFsPath(version.path)),
    );
    baseVersions = await capturedVersions(sessionId, modRoot, 'variant', sourceId, variantId, [...versions, ...parentVersions]);
    const write = {
      baseVersions,
      sessionId,
      modRoot,
      previousId,
      nextId: variantId,
      data,
      relPath,
    };
    return retainConfigReservation(runConfirmedJsonWrite(feedback, (options) => saveVariantEntity(write, options)));
  };
  const captured = await captureConfigIdentityIntent(sessionId, 'variant', sourceId, variantId);
  const targets = captured.info.baseVersions.map((version) => ({ sessionId, modRoot, path: version.path }));
  const result =
    feedback && sourceId !== variantId && !useSaveCommandStore().isPreparingParticipant(targetKey)
      ? await withEditTargetHandoff(targets, feedback, save, targetKey, (cleanup) => {
          release = cleanup;
        })
      : await save();
  if (!result) return null;
  if (release) variantHandoffs.set(result.commitId, release);
  const variant = jsonEntitySavedData(result);
  return { entity: variant, receipt: result };
}

export async function createVariantAction(
  sessionId: string,
  modRoot: string,
  hullId: string,
  variantId: string,
): Promise<SavedConfig<JsonEntityFile>> {
  const baseVersions = await capturedVersions(sessionId, modRoot, 'variant', variantId, variantId, [], true);
  const result = await retainConfigReservation(
    createVariantEntity({
      baseVersions,
      sessionId,
      modRoot,
      previousId: null,
      relPath: null,
      nextId: variantId,
      data: createDefaultVariant(hullId, variantId),
    }),
  );
  const variant = jsonEntitySavedData(result);
  return { entity: variant, receipt: result };
}

export async function deleteVariantAction(
  sessionId: string,
  modRoot: string,
  relPath: string,
  variantId: string,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  const result = await deleteVariantEntity({ sessionId, modRoot, relPath, entityId: variantId, baseVersions });
  return result;
}

export async function saveSkinAction(
  sessionId: string,
  modRoot: string,
  skinHullId: string,
  data: RowData,
  previousId: string | null,
  relPath: string,
  feedback?: AppFeedback,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<SavedConfig<JsonEntityFile> | null> {
  baseVersions = await capturedVersions(sessionId, modRoot, 'skin', previousId ?? skinHullId, skinHullId, baseVersions);
  const write = {
    baseVersions,
    sessionId,
    modRoot,
    previousId,
    nextId: skinHullId,
    data,
    relPath,
  };
  const result = await retainConfigReservation(runConfirmedJsonWrite(feedback, (options) => saveSkinEntity(write, options)));
  if (!result) return null;
  const skin = jsonEntitySavedData(result);
  return { entity: skin, receipt: result };
}

export async function createSkinAction(
  sessionId: string,
  modRoot: string,
  baseHullId: string,
  skinHullId: string,
): Promise<SavedConfig<JsonEntityFile>> {
  const baseVersions = await capturedVersions(sessionId, modRoot, 'skin', skinHullId, skinHullId, [], true);
  const result = await retainConfigReservation(
    createSkinEntity({
      baseVersions,
      sessionId,
      modRoot,
      previousId: null,
      relPath: null,
      nextId: skinHullId,
      data: createDefaultSkin(baseHullId, skinHullId),
    }),
  );
  const skin = jsonEntitySavedData(result);
  return { entity: skin, receipt: result };
}

export async function deleteSkinAction(
  sessionId: string,
  modRoot: string,
  relPath: string,
  skinHullId: string,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  const result = await deleteSkinEntity({ sessionId, modRoot, relPath, entityId: skinHullId, baseVersions });
  return result;
}

export async function completeJsonSave(modRoot: string, sessionId: string, result: WriteResult<unknown>, label: string) {
  const release = variantHandoffs.get(result.commitId);
  if (release) {
    variantHandoffs.delete(result.commitId);
    await release();
  }
  await releaseNativeWindowTargets();
  await completeSavedWrite({ modRoot, sessionId, result, label });
}

export async function recreateJsonSourcesAction(
  plan: import('@/shared/types').JsonRecoveryPlan,
  baseline: RowData,
  feedback: AppFeedback,
  targetKey: string,
) {
  const { sessionId, modRoot } = plan.request;
  await retryPendingModSyncs(modRoot);
  if (useSaveCommandStore().isPreparingParticipant(targetKey)) return recreateJsonSources({ sessionId, modRoot, plan, baseline });
  return withEditTargetHandoff(
    plan.baseVersions.map((version) => ({ sessionId, modRoot, path: version.path })),
    feedback,
    () => recreateJsonSources({ sessionId, modRoot, plan, baseline }),
    targetKey,
  );
}
