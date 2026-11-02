import type { EntityEditInfo, FileVersion, EntityKind } from '@/shared/types/project-identity.types';
export interface EditableFileData {
  entity: EntityEditInfo | null;
  path: string;
  text: string;
  baseVersions: FileVersion[];
}

export interface TextSave {
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

export interface FollowTextIdentityPayload {
  kind: EntityKind;
  text: string;
  nextId: string;
}
