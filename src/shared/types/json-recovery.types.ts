import type { FileVersion, JsonDocumentOrigin } from '@/shared/types/project-identity.types';
import type { RowData, JsonValue } from '@/shared/types/json.types';

export type { JsonDocumentOrigin } from './project-identity.types';
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
export interface JsonSourceRestore {
  sessionId: string;
  modRoot: string;
  plan: JsonRecoveryPlan;
  baseline: RowData;
}
