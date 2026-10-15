import type { ResourceRef } from '@/shared/types/project-identity.types';
import type { DeepReadonly } from './query-cache.types';
import type { RowData } from './json.types';
export type WeaponFirePreviewSource = { kind: 'saved' } | { kind: 'draft'; weapon: RowData };
export interface WeaponFirePreviewData {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  weapon: DeepReadonly<RowData>;
  weaponCsvRow: DeepReadonly<RowData>;
  projectileSpecs: DeepReadonly<Record<string, RowData>>;
  resourceRefs: readonly ResourceRef[];
  weaponSpriteData: Readonly<Record<string, string>>;
}
