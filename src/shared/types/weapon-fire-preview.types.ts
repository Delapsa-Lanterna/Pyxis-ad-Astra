import type { DeepReadonly } from './query-cache.types';
import type { ResourceRef } from './query.types';
import type { RowData } from './json.types';
export type WeaponFirePreviewSource = { kind: 'saved' } | { kind: 'draft'; weapon: RowData };
export interface WeaponFirePreviewData {
  baseVersions: import('./write.types').FileVersion[];
  weapon: DeepReadonly<RowData>;
  weaponCsvRow: DeepReadonly<RowData>;
  projectileSpecs: DeepReadonly<Record<string, RowData>>;
  resourceRefs: readonly ResourceRef[];
  weaponSpriteData: Readonly<Record<string, string>>;
}
