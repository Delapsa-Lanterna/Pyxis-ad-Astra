import type { FileVersion } from '@/shared/types/project-identity.types';
import type { RowData, JsonValue } from '@/shared/types/json.types';

export type JsonDocumentOrigin =
  { kind: 'modInfo' } | { kind: 'entity'; target: import('@/shared/types/config-entity.types').ConfigEditTarget };
export interface JsonRecoveryRequest {
  sessionId: string;
  modRoot: string;
  origin: JsonDocumentOrigin;
}
export interface JsonRecoveryPlan {
  request: JsonRecoveryRequest;
  baseVersions: FileVersion[];
  missingPaths: string[];
  currentSources: Record<string, JsonValue>;
}
export interface RecreateJsonSourcesPayload {
  sessionId: string;
  modRoot: string;
  plan: JsonRecoveryPlan;
  baseline: RowData;
}
