import type { EntityTargetSnapshot, FileVersion, EntityKind } from '@/shared/types/project-identity.types';
export interface TextFileData {
  entity: EntityTargetSnapshot | null;
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
export interface TextBatchSave {
  sessionId: string;
  modRoot: string;
  baseVersions: FileVersion[];
  files: { path: string; target: string | null; text: string }[];
}

export interface TextTranscode {
  baseVersions: FileVersion[];
  sessionId: string | null;
  modRoot: string;
  path: string;
  encoding: string;
}

export interface LoadTextFilePayload {
  sessionId: string | null;
  modRoot: string;
  path: string;
}

export interface FollowTextIdentityPayload {
  kind: EntityKind;
  text: string;
  nextId: string;
}
