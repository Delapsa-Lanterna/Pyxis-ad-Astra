import type { ImmersiveEditorDefinition } from '@/domain/immersive/fields';
import { immersiveEditableRecords, variantEditableRecords } from '@/domain/immersive/source-records';
import { projectShipPanel, shipProjectionInputs, type ShipImmersivePanel } from '@/domain/immersive/ship/ship-panel';
import {
  projectWeaponPanel,
  updateImmersiveWeaponField,
  weaponProjectionInputs,
  type WeaponPanel,
} from '@/domain/immersive/weapon/weapon-panel';
import { projectWingPanel, type WingPanel } from '@/domain/immersive/wing/wing-panel';
import { projectVariantPanel, variantProjectionInputs, type VariantPanel } from '@/domain/immersive/variant/variant-panel';
import { computed } from 'vue';
import type { JointEditRoot } from '@/shared/types';
import { useImmersiveEditorRuntime } from './immersive-editor/use-immersive-editor-runtime';
import { useImmersiveVariantEditor } from './immersive-editor/variant/use-immersive-variant-editor';
import { useImmersiveWingEditor } from './immersive-editor/wing/use-immersive-wing-editor';
import { useImmersiveWeaponEditor } from './immersive-editor/weapon/use-immersive-weapon-editor';

type ImmersivePanel = ShipImmersivePanel | WeaponPanel | WingPanel | VariantPanel;
const immersiveEditorDefinitions: Record<JointEditRoot['kind'], ImmersiveEditorDefinition<ImmersivePanel>> = {
  variant: {
    retainProjectedContent: true,
    label: '装配',
    editableRecords: variantEditableRecords,
    project: projectVariantPanel,
    projectionInputs: variantProjectionInputs,
    displayResources: () => [],
  },
  wing: {
    retainProjectedContent: false,
    label: '战机联队',
    editableRecords: immersiveEditableRecords,
    project: projectWingPanel,
    projectionInputs: (_snapshot, values) => ({ records: Object.entries(values) }),
    displayResources: (panel) => (panel.kind === 'wing' && panel.sprite ? [panel.sprite] : []),
  },
  skin: {
    retainProjectedContent: false,
    label: '舰船皮肤',
    editableRecords: immersiveEditableRecords,
    project: projectShipPanel,
    projectionInputs: (_snapshot, values) => ({ records: Object.entries(values) }),
    displayResources: (panel) => (panel.kind === 'ship' && panel.sprite ? [panel.sprite] : []),
  },
  ship: {
    retainProjectedContent: false,
    label: '舰船',
    editableRecords: immersiveEditableRecords,
    project: projectShipPanel,
    projectionInputs: shipProjectionInputs,
    displayResources: (panel) => (panel.kind === 'ship' && panel.sprite ? [panel.sprite] : []),
  },
  weapon: {
    retainProjectedContent: false,
    updateField: updateImmersiveWeaponField,
    label: '武器',
    editableRecords: immersiveEditableRecords,
    project: projectWeaponPanel,
    projectionInputs: weaponProjectionInputs,
    displayResources: (panel) =>
      panel.kind === 'weapon'
        ? [
            ...panel.iconLayers.map((layer) => layer.resource),
            ...(panel.damageIcon ? [panel.damageIcon] : []),
            ...(panel.loadedMissile ? [panel.loadedMissile.resource] : []),
          ]
        : [],
  },
};

export function useImmersiveEditorViewModel(root: JointEditRoot & { rowKey?: string }) {
  const runtime = useImmersiveEditorRuntime(root, immersiveEditorDefinitions[root.kind], {
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
