import { recreateJsonSources } from '@/services/json-recovery.service';
import type {
  AppFeedback,
  SavedConfig,
  IndexedConfigKind,
  IndexedConfigEntityData,
  JsonEntityFile,
  JsonRecoveryPlan,
  EntityKind,
  FileVersion,
  VariantFile,
  SkinFile,
  WriteResult,
  RowData,
} from '@/shared/types';

import {
  createIndexedConfigEntity,
  saveIndexedConfigEntity,
  saveModInfo,
  captureConfigIdentityIntent,
} from '@/services/json-entity.service';
import { createSkinEntity, createVariantEntity, saveSkinEntity, saveVariantEntity } from '@/services/json-file.service';
import { createDefaultSkin, createDefaultVariant } from '@/domain/json-editor/json-file-defaults';
import { indexedConfigEntityData } from '@/domain/json-editor/json-config-records';
import { jsonEntitySavedData } from '@/domain/json-editor/json-file-records';
import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';

import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';

import { reserveFileIdentityIntent } from '@/orchestrators/entity-identity.orchestrator';
import { focusEntityIdentityConflict } from '@/orchestrators/window-target-focus.orchestrator';
import { releaseNativeWindowTargets } from '@/services/window.service';
import { captureIdentityVersions } from '@/domain/project/entity-versions';

async function capturedVersions(
  sessionId: string,
  modRoot: string,
  kind: EntityKind,
  sourceId: string,
  nextId: string,
  baseVersions: FileVersion[],
  create = false,
) {
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
  baseVersions: FileVersion[] = [],
  original?: RowData,
  request?: SaveCommandRequest,
): Promise<WriteResult | null> {
  return runConfirmedJsonWrite(feedback, (options) => saveModInfo(sessionId, modRoot, data, options, baseVersions, original, request));
}

export async function saveIndexedEntityAction(
  write: {
    baseVersions: FileVersion[];
    sessionId: string;
    modRoot: string;
    kind: IndexedConfigKind;
    previousId: string | null;
    nextId: string;
    indexRow: RowData;
    entityData: RowData;
  },
  feedback?: AppFeedback,
  original?: RowData,
  request?: SaveCommandRequest,
): Promise<SavedConfig<IndexedConfigEntityData> | null> {
  const versions = await capturedVersions(
    write.sessionId,
    write.modRoot,
    write.kind,
    write.previousId ?? write.nextId,
    write.nextId,
    write.baseVersions,
  );
  const result = await retainConfigReservation(
    runConfirmedJsonWrite(feedback, (options) => saveIndexedConfigEntity({ ...write, baseVersions: versions }, options, original, request)),
  );
  if (!result) return null;
  const entity = indexedConfigEntityData(result);
  return { entity, receipt: result };
}

export async function createIndexedEntityAction(
  write: {
    baseVersions: FileVersion[];
    sessionId: string;
    modRoot: string;
    kind: IndexedConfigKind;
    previousId: null;
    nextId: string;
    indexRow: RowData;
    entityData: RowData;
  },
  request?: SaveCommandRequest,
): Promise<SavedConfig<IndexedConfigEntityData>> {
  const baseVersions = await capturedVersions(write.sessionId, write.modRoot, write.kind, write.nextId, write.nextId, [], true);
  const result = await retainConfigReservation(createIndexedConfigEntity({ ...write, baseVersions }, request));
  const entity = indexedConfigEntityData(result);
  return { entity, receipt: result };
}

export async function saveJsonFileAction(
  kind: 'variant' | 'skin',
  sessionId: string,
  modRoot: string,
  id: string,
  data: RowData,
  previousId: string | null,
  relPath: string,
  feedback?: AppFeedback,
  baseVersions: FileVersion[] = [],
  original?: RowData,
  request?: SaveCommandRequest,
): Promise<SavedConfig<JsonEntityFile> | null> {
  const saveEntity = kind === 'variant' ? saveVariantEntity : saveSkinEntity;
  baseVersions = await capturedVersions(sessionId, modRoot, kind, previousId ?? id, id, baseVersions);
  const result = await retainConfigReservation(
    runConfirmedJsonWrite<WriteResult<VariantFile | SkinFile>>(feedback, (options) =>
      saveEntity({ baseVersions, sessionId, modRoot, previousId, nextId: id, data, relPath }, options, original, request),
    ),
  );
  return result ? { entity: jsonEntitySavedData(result), receipt: result } : null;
}

export async function createJsonFileAction(
  kind: 'variant' | 'skin',
  sessionId: string,
  modRoot: string,
  baseHullId: string,
  id: string,
  request?: SaveCommandRequest,
): Promise<SavedConfig<JsonEntityFile>> {
  const createEntity = kind === 'variant' ? createVariantEntity : createSkinEntity;
  const initial = kind === 'variant' ? createDefaultVariant : createDefaultSkin;
  const baseVersions = await capturedVersions(sessionId, modRoot, kind, id, id, [], true);
  const result = await retainConfigReservation<WriteResult<VariantFile | SkinFile>>(
    createEntity({ baseVersions, sessionId, modRoot, previousId: null, relPath: null, nextId: id, data: initial(baseHullId, id) }, request),
  );
  return { entity: jsonEntitySavedData(result), receipt: result };
}

export async function recreateJsonSourcesAction(
  plan: JsonRecoveryPlan,
  baseline: RowData,
  feedback: AppFeedback,
  targetKey: string,
  request?: SaveCommandRequest,
) {
  const { sessionId, modRoot } = plan.request;
  void feedback;
  void targetKey;
  return recreateJsonSources({ sessionId, modRoot, plan, baseline }, request);
}
