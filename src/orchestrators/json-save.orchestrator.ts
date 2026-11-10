import { saveIndexedConfigEntity, createIndexedConfigEntity, captureConfigIdentityIntent } from '@/services/json-entity.service';
import { createSkinEntity, createVariantEntity, saveSkinEntity, saveVariantEntity } from '@/services/json-file.service';
import { releaseNativeWindowTargets } from '@/services/window.service';
import { createDefaultSkin, createDefaultVariant } from '@/domain/entity-write/spec-construction';
import { prepareJsonWrite } from '@/domain/schema/game-number';
import { captureIdentityVersions } from '@/domain/project/entity-versions';
import { reserveFileIdentityIntent } from './window-identity.orchestrator';
import { chooseEntityFilename } from './entity-write.orchestrator';
import { focusEntityIdentityConflict } from './window-target-focus.orchestrator';
import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';
import type { DocumentEdit } from '@/shared/types';
import type {
  AppFeedback,
  EntityKind,
  FileVersion,
  IndexedConfigSave,
  JsonFileSave,
  RowData,
  JsonComposition,
  WriteResult,
  VariantFile,
  SkinFile,
} from '@/shared/types';

interface IdentityWrite {
  sessionId: string;
  modRoot: string;
  kind: EntityKind;
  previousId: string | null;
  nextId: string;
  baseVersions: FileVersion[];
}
interface IdentityContent {
  original: RowData;
  data: RowData;
  composition?: JsonComposition;
}

async function settleIdentity(write: IdentityWrite, feedback?: AppFeedback, content?: IdentityContent) {
  const { sessionId, modRoot, kind, nextId } = write;
  const captured = await captureConfigIdentityIntent(sessionId, kind, write.previousId ?? nextId, nextId).catch(async (error) => {
    await focusEntityIdentityConflict(sessionId, modRoot, error);
    throw error;
  });
  const keepFilename =
    write.previousId === null
      ? false
      : await chooseEntityFilename(
          feedback,
          captured.snapshot.target,
          captured.intent,
          content ? { before: content.original, after: content.data, composition: content.composition } : undefined,
        );
  if (keepFilename === null) return null;
  const intent = keepFilename
    ? (await captureConfigIdentityIntent(sessionId, kind, write.previousId!, write.previousId!)).intent
    : captured.intent;
  await reserveFileIdentityIntent(sessionId, modRoot, intent);
  return {
    keepFilename,
    baseVersions: captureIdentityVersions(
      write.previousId === null ? captured.snapshot.baseVersions : write.baseVersions,
      intent.destinationVersion,
    ),
  };
}

async function withReservation<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    await releaseNativeWindowTargets();
    throw error;
  }
}

export async function saveIndexedEntityAction(
  write: IndexedConfigSave,
  edits: DocumentEdit[],
  feedback?: AppFeedback,
  content?: IdentityContent,
  request?: SaveCommandRequest,
) {
  const identity = await settleIdentity(write, feedback, content);
  if (!identity) return null;
  return withReservation(() =>
    saveIndexedConfigEntity(
      { ...write, baseVersions: identity.baseVersions, jsonWrite: { ...write.jsonWrite, keepFilename: identity.keepFilename } },
      edits,
      request,
    ),
  );
}

export async function createIndexedEntityAction(write: IndexedConfigSave, request?: SaveCommandRequest) {
  const identity = await settleIdentity({ ...write, previousId: null });
  return withReservation(() => createIndexedConfigEntity({ ...write, baseVersions: identity!.baseVersions }, request));
}

export async function saveJsonFileAction(
  kind: 'variant' | 'skin',
  write: JsonFileSave,
  edits: DocumentEdit[],
  feedback?: AppFeedback,
  content?: IdentityContent,
  request?: SaveCommandRequest,
) {
  const identity = await settleIdentity({ ...write, kind }, feedback, content);
  if (!identity) return null;
  const save = kind === 'variant' ? saveVariantEntity : saveSkinEntity;
  return withReservation<WriteResult<VariantFile | SkinFile>>(() =>
    save(
      { ...write, baseVersions: identity.baseVersions, jsonWrite: { ...write.jsonWrite, keepFilename: identity.keepFilename } },
      edits,
      request,
    ),
  );
}

export async function createJsonFileAction(
  kind: 'variant' | 'skin',
  sessionId: string,
  modRoot: string,
  baseHullId: string,
  id: string,
  request?: SaveCommandRequest,
) {
  const identity = await settleIdentity({ sessionId, modRoot, kind, previousId: null, nextId: id, baseVersions: [] });
  const create = kind === 'variant' ? createVariantEntity : createSkinEntity;
  const initial = kind === 'variant' ? createDefaultVariant : createDefaultSkin;
  return withReservation<WriteResult<VariantFile | SkinFile>>(() =>
    create(
      {
        sessionId,
        modRoot,
        previousId: null,
        nextId: id,
        relPath: null,
        baseVersions: identity!.baseVersions,
        document: prepareJsonWrite(initial(baseHullId, id)),
        jsonWrite: {},
      },
      request,
    ),
  );
}
