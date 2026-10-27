import { computed } from 'vue';
import type { JointEditRoot } from '@/shared/types';
import { immersiveDefinition, type ImmersiveEditorKind } from '@/domain/immersive/editor-definition';
import { useImmersiveEditorRuntime } from './immersive-editor/use-immersive-editor-runtime';
import { useImmersiveVariantEditor } from './immersive-editor/variant/use-immersive-variant-editor';
import { useImmersiveWingEditor } from './immersive-editor/wing/use-immersive-wing-editor';
import { useImmersiveWeaponEditor } from './immersive-editor/weapon/use-immersive-weapon-editor';

export function useImmersiveEditorViewModel(root: JointEditRoot & { kind: ImmersiveEditorKind; rowKey?: string }) {
  const runtime = useImmersiveEditorRuntime(root, immersiveDefinition(root.kind), {
    readSnapshot: root.kind === 'wing' ? (target, signal) => wing!.readSnapshot(target, signal) : undefined,
    onProjection: root.kind === 'wing' ? (target) => wing!.refreshWingBaseline(target) : undefined,
  });
  const variant = root.kind === 'variant' ? useImmersiveVariantEditor(runtime) : null;
  const wing: ReturnType<typeof useImmersiveWingEditor> | null = root.kind === 'wing' ? useImmersiveWingEditor(runtime) : null;
  const weapon = root.kind === 'weapon' ? useImmersiveWeaponEditor(runtime) : null;
  return {
    ...runtime,
    variant,
    wing,
    variantActionPending: computed(() => variant?.variantActionPending.value ?? false),
    createOverrides: weapon?.createOverrides ?? runtime.createOverrides,
    openProjectile: weapon?.openProjectile,
    openPreview: weapon?.openPreview,
    save: async () => {
      if (!variant?.variantActionPending.value) await runtime.save();
    },
  };
}

import type { ImmersiveRenderContext } from '@/app/components/immersive/immersive-render-context';

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
    },
  };
}
