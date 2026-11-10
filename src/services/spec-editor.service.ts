import type { DocumentEdit } from '@/shared/types';
import { invokeCommand, invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import { querySessionEntityIdentityIntent } from './entity-query.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { entityContentId, entityContentIdField } from '@/domain/project/entity-definitions';
import type { JsonFileContent } from '@/shared/types';
import type {
  SpecSave,
  SpecEditorKind,
  EntityEditTarget,
  EntityIdentityIntent,
  LoadImportedEditorSpecPayload,
  RowData,
  WriteResult,
} from '@/shared/types';

export function saveSpecEditorSpec(
  payload: SpecSave,
  edits: DocumentEdit[],
  request?: SaveCommandRequest,
): Promise<WriteResult<JsonFileContent>> {
  return invokeSaveCommand('save_editor_spec', { payload }, edits, request);
}
export function querySpecEditorIdentityIntent(sessionId: string, target: EntityEditTarget, content: RowData, signal?: AbortSignal) {
  const identity =
    content[entityContentIdField(target.kind)] === undefined
      ? target.write.relPath
          .split('/')
          .at(-1)!
          .replace(/\.[^.]+$/, '')
      : entityContentId(target.kind, content);
  return querySessionEntityIdentityIntent(sessionId, target, identity, signal).then((value) =>
    cloneQuerySnapshot<EntityIdentityIntent>(value),
  );
}
export function loadSpecEditorImport(kind: SpecEditorKind, path: string): Promise<JsonFileContent> {
  return invokeCommand('load_imported_editor_spec_file', { payload: { kind, path } satisfies LoadImportedEditorSpecPayload });
}
