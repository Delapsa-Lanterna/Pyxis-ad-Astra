import type { ResourceRef, ResourceSource, ResourceOwnerKind } from '@/shared/types/project-identity.types';
import type { RowData } from '@/shared/types/json.types';
import type { FileVersion, ReferenceSource } from './project-identity.types';
import type { ErrorDiagnostic } from './error.types';

export type EngineEffect = 'engineGlow' | 'engineFlame' | 'engineHitGlow';
export interface EngineRenderAssets {
  styles: RowData;
  versions: FileVersion[];
  resources: Record<string, ResourceRef>;
}

export interface ResourceDataUrlBatchEntry {
  reference?: ReferenceSource;
  key: string;
  source: ResourceSource;
  relPath: string;
  ownerKind: ResourceOwnerKind;
  ownerId: string;
  dataUrl: string | null;
  error?: ErrorDiagnostic;
}

export interface ResourceDataUrlBatchResult {
  entries: ResourceDataUrlBatchEntry[];
}

export interface HullReferenceOption {
  label: string;
  value: string;
  origin: ResourceSource;
  kind: HullReferenceKind;
  resourceRef: ResourceRef | null;
}

export type HullReferenceKind = 'ship' | 'skin';

export interface HullReferenceGroup {
  reference?: ReferenceSource;
  origin: ResourceSource;
  kind: HullReferenceKind;
  options: HullReferenceOption[];
}

export interface HullReferencesResult {
  groups: HullReferenceGroup[];
  hullNames: Record<string, string>;
  sprites: Record<string, ResourceRef>;
  builtInWeaponSlots: Record<string, HullWeaponSlot[]>;
  weaponSlots: Record<string, HullWeaponSlot[]>;
  moduleSlots: Record<string, HullWeaponSlot[]>;
}

export type DraftResourceEntityKind = 'ship' | 'weapon' | 'projectile' | 'system' | 'faction' | 'mission';

export interface DraftResourcesPayload {
  kind: DraftResourceEntityKind;
  sessionId: string;
  id: string;
  draft: RowData;
}

export interface ResourceDataUrlBatchPayload {
  sessionId: string;
  resources: ResourceRef[];
}

export interface ResolveModRelativePathPayload {
  sessionId: string;
  modRoot: string;
  absolutePath: string;
}

export interface HullReferencesPayload {
  sessionId: string;
  referenceIds: string[];
}

export interface HullWeaponSlot {
  id: string;
  origin: ResourceSource;
  size?: string;
  type?: string;
  mount?: string;
}
