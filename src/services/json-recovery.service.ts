import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { JsonRecoveryPlan, JsonRecoveryRequest, RecreateJsonSourcesPayload } from '@/shared/types';
import type { WriteResult } from '@/shared/types';

export function prepareJsonSourceRecovery(payload: JsonRecoveryRequest): Promise<JsonRecoveryPlan> {
  return invokeCommand('prepare_json_source_recovery', { payload });
}
export function recreateJsonSources(payload: RecreateJsonSourcesPayload): Promise<WriteResult<JsonRecoveryPlan>> {
  return invokeCommand('recreate_json_sources', { payload });
}
