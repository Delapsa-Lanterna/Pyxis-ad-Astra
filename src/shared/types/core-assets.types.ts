import type { ResourceSource } from '@/shared/types/project-identity.types';

export interface DiscoveredField {
  key: string;
  type: DiscoveredFieldType;
  origin: ResourceSource;
}

export type DiscoveredFieldType =
  'boolean' | 'integer' | 'float' | 'string' | 'path-image' | 'string-array' | 'color-rgba' | 'array-of-object' | 'tag-select' | 'object';

export interface CoreScanPayload {
  starsectorRoot: string;
}

export interface CoreRootPayload {
  sessionId: string | null;
  starsectorRoot: string | null;
}

export interface InvalidateCoreCachePayload {
  starsectorRoot: string;
}
