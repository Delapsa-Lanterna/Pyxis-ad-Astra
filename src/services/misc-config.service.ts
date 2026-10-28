import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';
import { captureSaveEdits } from '@/domain/project/save-edits';
import type { JsonValue } from '@/shared/types';
import { invokeCommand, invokeSaveCommand } from '@/shared/runtime/command.runtime';
import { pathBelongsToRoot } from '@/shared/lib/paths';
import { MISC_CONFIG_FILES, miscConfigFile } from '@/domain/json-editor/misc-config-files';
import { readLiveSessionQuery, type SessionQueryDefinition } from '@/services/query-cache.service';
import type {
  MiscConfigEntry,
  MiscConfigKind,
  MiscConfigRead,
  MiscConfigFile,
  MiscConfigWrite,
  MiscConfigDelete,
  MiscConfigScope,
  WriteResult,
  ProjectInvalidation,
} from '@/shared/types';

function affectsMiscConfig(invalidation: ProjectInvalidation, modRoot: string, kind?: MiscConfigKind) {
  const files = kind ? [miscConfigFile(kind)] : MISC_CONFIG_FILES;
  return invalidation.paths.some((path) => files.some((file) => pathBelongsToRoot(modRoot + '/' + file.path, path)));
}
const directory = {
  queryKind: 'misc-config-files',
  load: ({ sessionId, parameters }) =>
    invokeCommand('query_misc_config_files', { payload: { sessionId, ...parameters } satisfies MiscConfigScope }),
  invalidates: ({ modRoot }, invalidation) => affectsMiscConfig(invalidation, modRoot),
} satisfies SessionQueryDefinition<{ modRoot: string }, MiscConfigEntry[]>;
const read = {
  queryKind: 'misc-config-file',
  load: ({ sessionId, parameters }) =>
    invokeCommand('query_misc_config_file', { payload: { sessionId, ...parameters } satisfies MiscConfigRead }),
  invalidates: ({ modRoot, kind }, invalidation) => affectsMiscConfig(invalidation, modRoot, kind),
} satisfies SessionQueryDefinition<{ modRoot: string; kind: MiscConfigKind }, MiscConfigFile | null>;
export const queryMiscConfigFiles = (sessionId: string, modRoot: string, signal?: AbortSignal) =>
  readLiveSessionQuery(directory, sessionId, { modRoot }, signal);
export const queryMiscConfigFile = (sessionId: string, modRoot: string, kind: MiscConfigKind, signal?: AbortSignal) =>
  readLiveSessionQuery(read, sessionId, { modRoot, kind }, signal);
export function hasMiscConfigInvalidation(invalidation: ProjectInvalidation, modRoot: string, kind?: MiscConfigKind) {
  return invalidation.session || affectsMiscConfig(invalidation, modRoot, kind);
}
export function saveMiscConfig(
  payload: MiscConfigWrite,
  original?: JsonValue,
  request?: import('@/shared/runtime/command.runtime').SaveCommandRequest,
): Promise<WriteResult<MiscConfigFile['data']>> {
  return invokeSaveCommand(
    'save_misc_config',
    { payload },
    original === undefined ? [{ kind: 'set', path: [], value: payload.data }] : captureSaveEdits(original, payload.data),
    request,
  );
}
export function deleteMiscConfig(payload: MiscConfigDelete, request?: SaveCommandRequest): Promise<WriteResult> {
  return invokeSaveCommand('delete_misc_config', { payload }, [], request);
}
