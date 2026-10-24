import type { FileVersion } from '@/shared/types/project-identity.types';
import type { RowData, JsonValue } from '@/shared/types/json.types';

export type JsonDocumentOrigin =
  | { kind: 'modInfo' }
  | { kind: 'miscConfig'; file: import('./misc-config.types').MiscConfigKind }
  | { kind: 'entity'; target: import('@/shared/types/config-entity.types').ConfigEditTarget };
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
  resourceRefs: Record<string, import('./project-identity.types').ResourceRef>;
}
export interface RecreateJsonSourcesPayload {
  sessionId: string;
  modRoot: string;
  plan: JsonRecoveryPlan;
  baseline: RowData;
}
