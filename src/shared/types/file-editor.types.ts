export interface EditableFileData {
  entity: import('@/shared/types/project-identity.types').EntityEditInfo | null;
  path: string;
  text: string;
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
}

export interface TextSave {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  sessionId: string | null;
  modRoot: string;
  path: string;
  text: string;
}

export interface TextTranscode {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
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
  source: import('@/shared/types/project-identity.types').EntityEditTarget;
  text: string;
}

export interface FollowTextIdentityPayload {
  kind: import('@/shared/types/project-identity.types').EntityKind;
  text: string;
  nextId: string;
}
