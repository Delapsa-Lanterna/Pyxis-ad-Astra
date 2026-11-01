import { invokeCommand, invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import type { JsonRecoveryPlan, JsonRecoveryRequest, JsonSourceRestore } from '@/shared/types';
import type { WriteResult } from '@/shared/types';

export function prepareJsonSourceRecovery(payload: JsonRecoveryRequest): Promise<JsonRecoveryPlan> {
  return invokeCommand('prepare_json_source_recovery', { payload });
}
export function recreateJsonSources(payload: JsonSourceRestore, request?: SaveCommandRequest): Promise<WriteResult<JsonRecoveryPlan>> {
  return invokeSaveCommand('recreate_json_sources', { payload }, [], request);
}
