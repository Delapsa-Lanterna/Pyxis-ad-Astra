import type { FileVersion } from '@/shared/types/project-identity.types';
import type { RowData, JsonValue } from '@/shared/types/json.types';

import type { JsonDocumentOrigin } from './document-identity.types';
import type { ResourceRef } from './project-identity.types';
import type { JsonFileContent, JsonFileWrite } from './file-content.types';

export type { JsonDocumentOrigin } from './document-identity.types';
export interface JsonRecoveryRequest {
  sessionId: string;
  modRoot: string;
  origin: JsonDocumentOrigin;
}
export interface JsonRecoveryPlan {
  documents: Record<string, JsonFileContent>;
  request: JsonRecoveryRequest;
  baseVersions: FileVersion[];
  missingPaths: string[];
  currentSources: Record<string, JsonValue>;
  resourceRefs: Record<string, ResourceRef>;
}
export interface JsonSourceRestore {
  originals: Record<string, JsonFileContent>;
  documents: Record<string, JsonFileWrite>;
  sessionId: string;
  modRoot: string;
  plan: JsonRecoveryPlan;
  baseline: RowData;
}
