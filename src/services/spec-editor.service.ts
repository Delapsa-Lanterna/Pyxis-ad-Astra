import type { SpecSave, LoadImportedEditorSpecPayload } from '@/shared/types';
import { querySessionEntityIdentityIntent } from '@/services/entity-query.service';
import { AppError, withCause } from '@/shared/lib/errors';
import { invokeCommand, invokeSaveCommand } from '@/shared/runtime/command.runtime';
import { entityContentId } from '@/domain/project/entity-definitions';
import { requireRowData } from '@/shared/lib/row-data';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { captureSaveEdits } from '@/domain/project/save-edits';
import type { EntityEditTarget, SpecEditorKind, RowData, WriteResult } from '@/shared/types';

export async function saveSpecEditorSpecByKind(
  sessionId: string,
  modRoot: string,
  target: EntityEditTarget,
  data: RowData,
  jsonWrite?: import('@/shared/types/index').JsonWriteOptions,
  baseVersions: import('@/shared/types/index').FileVersion[] = [],
  original?: RowData,
  request?: import('@/shared/runtime/command.runtime').SaveCommandRequest,
): Promise<WriteResult> {
  ensureSpecContext(modRoot, target.id);
  try {
    const result = await saveSpecEditorSpec(sessionId, modRoot, target, data, jsonWrite, baseVersions, original, request);
    return { ...result, content: { target: result.content!.target, value: requireRowData(result.content?.value, '规格保存返回内容无效') } };
  } catch (error) {
    throw withCause(`保存 ${target.id} spec 失败`, error, `save-${target.kind}-spec`);
  }
}

export function saveSpecEditorSpec(
  sessionId: string,
  modRoot: string,
  target: EntityEditTarget,
  data: RowData,
  jsonWrite?: import('@/shared/types/index').JsonWriteOptions,
  baseVersions: import('@/shared/types/index').FileVersion[] = [],
  original?: RowData,
  request?: import('@/shared/runtime/command.runtime').SaveCommandRequest,
): Promise<WriteResult> {
  return invokeSaveCommand(
    'save_editor_spec',
    {
      payload: {
        baseVersions,
        sessionId,
        modRoot,
        target,
        data,
        ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(data) } : {}),
      } satisfies SpecSave,
    },
    original === undefined ? [{ kind: 'set', path: [], value: data }] : captureSaveEdits(original, data),
    request,
  );
}

export function querySpecEditorIdentityIntent(sessionId: string, source: EntityEditTarget, content: RowData, signal?: AbortSignal) {
  return querySessionEntityIdentityIntent(sessionId, source, entityContentId(source.kind, content), signal).then((intent) =>
    cloneQuerySnapshot<import('@/shared/types/index').EntityIdentityIntent>(intent),
  );
}

export async function loadSpecEditorImport(kind: SpecEditorKind, path: string): Promise<RowData> {
  return invokeCommand('load_imported_editor_spec_file', { payload: { kind, path } satisfies LoadImportedEditorSpecPayload });
}

function ensureSpecContext(modRoot: string, id: string) {
  if (!modRoot) {
    throw new AppError('缺少 spec 保存的 mod 根目录', { action: 'save-spec' });
  }
  if (!id) {
    throw new AppError('缺少 spec 保存 id', { action: 'save-spec' });
  }
}
