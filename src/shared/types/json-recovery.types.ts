import type { FileVersion } from '@/shared/types/project-identity.types';
import type { RowData, JsonValue } from '@/shared/types/json.types';

import type { JsonDocumentOrigin } from './document-identity.types';
export type { JsonDocumentOrigin } from './document-identity.types';
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
