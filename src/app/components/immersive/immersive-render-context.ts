import type { JointEditRoot, JointEditSnapshot, JointEditRecord, JointValue, ResourceRef } from '@/shared/types';
import type { ImmersiveField, ImmersiveFieldChange, ImmersiveStat } from '@/domain/immersive/fields';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';

export interface ImmersiveEditing {
  readonly values: Record<string, JointValue>;
  readonly snapshot: JointEditSnapshot;
  readonly runtimeContext: SchemaRuntimeContext;
  readonly activeStat: string | null;
  readonly changing: boolean;
  readonly saving: boolean;
  readonly notices: JointEditRecord[];
  editable(field: ImmersiveField): boolean;
  toggle(id: string, show: boolean): Promise<void>;
  dismiss(): void;
  update(changes: ImmersiveFieldChange[]): void | Promise<void>;
  override(keys?: string[]): Promise<void>;
  create(key: string): Promise<void>;
}
interface ImmersiveDisplay {
  readonly root: JointEditRoot;
  readonly records: readonly JointEditRecord[];
  mediaUrl(resource: ResourceRef | null | undefined): string;
}
export type ImmersiveRenderContext = ImmersiveDisplay & ({ mode: 'readonly' } | { mode: 'editable'; editing: ImmersiveEditing });
export function descriptionForRender(stat: ImmersiveStat, mode: ImmersiveRenderContext['mode']): ImmersiveStat {
  return mode === 'editable' ? stat : { ...stat, display: stat.display.trim().split(/\r?\n\s*\r?\n/)[0]! };
}
