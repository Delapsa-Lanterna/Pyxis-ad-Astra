import { invokeCommand } from '@/shared/runtime/command.runtime';
import { pathBelongsToRoot } from '@/shared/lib/paths';
import { MISC_CONFIG_FILES, miscConfigFile } from '@/domain/json-editor/misc-config-files';
import { createLiveSessionQuery } from '@/services/query-cache.service';
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
const directory = createLiveSessionQuery<{ modRoot: string }, MiscConfigEntry[]>({
  queryKind: 'misc-config-files',
  load: ({ sessionId, parameters }) =>
    invokeCommand('query_misc_config_files', { payload: { sessionId, ...parameters } satisfies MiscConfigScope }),
  invalidates: ({ modRoot }, invalidation) => affectsMiscConfig(invalidation, modRoot),
});
const read = createLiveSessionQuery<{ modRoot: string; kind: MiscConfigKind }, MiscConfigFile | null>({
  queryKind: 'misc-config-file',
  load: ({ sessionId, parameters }) =>
    invokeCommand('query_misc_config_file', { payload: { sessionId, ...parameters } satisfies MiscConfigRead }),
  invalidates: ({ modRoot, kind }, invalidation) => affectsMiscConfig(invalidation, modRoot, kind),
});
export const queryMiscConfigFiles = (sessionId: string, modRoot: string, signal?: AbortSignal) => directory(sessionId, { modRoot }, signal);
export const queryMiscConfigFile = (sessionId: string, modRoot: string, kind: MiscConfigKind, signal?: AbortSignal) =>
  read(sessionId, { modRoot, kind }, signal);
export function hasMiscConfigInvalidation(invalidation: ProjectInvalidation, modRoot: string, kind?: MiscConfigKind) {
  return invalidation.session || affectsMiscConfig(invalidation, modRoot, kind);
}
export function saveMiscConfig(payload: MiscConfigWrite): Promise<WriteResult<MiscConfigFile['data']>> {
  return invokeCommand('save_misc_config', { payload });
}
export function deleteMiscConfig(payload: MiscConfigDelete): Promise<WriteResult> {
  return invokeCommand('delete_misc_config', { payload });
}
