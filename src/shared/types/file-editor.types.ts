import type { EntityEditInfo, FileVersion, EntityEditTarget, EntityKind } from '@/shared/types/project-identity.types';
import type { JsonWriteOptions } from './json-write.types';
export interface EditableFileData {
  entity: EntityEditInfo | null;
  path: string;
  text: string;
  baseVersions: FileVersion[];
}

export interface TextSave {
  jsonWrite?: JsonWriteOptions;
  baseVersions: FileVersion[];
  sessionId: string | null;
  modRoot: string;
  path: string;
  text: string;
}

export interface TextTranscode {
  baseVersions: FileVersion[];
  sessionId: string | null;
  modRoot: string;
  path: string;
  encoding: string;
}

export interface LoadEditableFilePayload {
  sessionId: string | null;
  modRoot: string;
  path: string;
}

export interface TextIdentityIntentPayload {
  sessionId: string;
  source: EntityEditTarget;
  text: string;
}

export interface FollowTextIdentityPayload {
  kind: EntityKind;
  text: string;
  nextId: string;
}
