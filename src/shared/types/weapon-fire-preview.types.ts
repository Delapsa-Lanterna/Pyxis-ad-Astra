import type { ResourceRef } from '@/shared/types/project-identity.types';
import type { DeepReadonly, RowData } from './json.types';

export type WeaponFirePreviewSource = { kind: 'saved' } | { kind: 'draft'; weapon: RowData };
export interface WeaponFirePreviewData {
  sessionId: string;
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  weapon: DeepReadonly<RowData>;
  weaponCsvRow: DeepReadonly<RowData>;
  projectile: DeepReadonly<RowData> | null;
  resources: { weapon: Readonly<Record<string, ResourceRef>>; projectile: Readonly<Record<string, ResourceRef>> };
}
