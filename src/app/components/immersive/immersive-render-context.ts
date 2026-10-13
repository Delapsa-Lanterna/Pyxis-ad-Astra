import type { JointEditRoot, JointEditSnapshot, JointEditRecord, JointValue, ResourceRef } from '@/shared/types';
import type { ImmersiveField, ImmersiveFieldChange, ImmersiveStat } from '@/domain/immersive/fields';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { useImmersiveEditorViewModel } from '@/app/composables/use-immersive-editor-view-model';

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
  openProjectile(): Promise<void>;
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
export function editableRenderContext(vm: ReturnType<typeof useImmersiveEditorViewModel>): ImmersiveRenderContext {
  return {
    mode: 'editable',
    get root() {
      return vm.joint.currentTarget.value!;
    },
    get records() {
      return vm.snapshot.value!.records;
    },
    mediaUrl: vm.mediaUrl,
    editing: {
      get values() {
        return vm.joint.draftValue.value;
      },
      get snapshot() {
        return vm.snapshot.value!;
      },
      get runtimeContext() {
        return vm.runtimeContext.value;
      },
      get activeStat() {
        return vm.selectedStatId.value;
      },
      get changing() {
        return vm.referenceChanging.value;
      },
      get saving() {
        return vm.joint.saving.value;
      },
      get notices() {
        return vm.notices.value;
      },
      editable: vm.editable,
      toggle: vm.toggleStat,
      dismiss: vm.dismissStat,
      update: vm.updateFields,
      override: vm.createOverrides,
      create: vm.createMissingSource,
      openProjectile: vm.openProjectile,
    },
  };
}
