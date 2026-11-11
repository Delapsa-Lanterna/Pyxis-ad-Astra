import type { FileVersion, EntityKind } from '@/shared/types/project-identity.types';
export interface TextTranscode {
  baseVersions: FileVersion[];
  sessionId: string | null;
  modRoot: string;
  path: string;
  encoding: string;
}

export interface FollowTextIdentityPayload {
  kind: EntityKind;
  text: string;
  nextId: string;
}
