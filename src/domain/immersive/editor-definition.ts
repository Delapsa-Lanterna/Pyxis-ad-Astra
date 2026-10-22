import type { ImmersiveEditorDefinition } from './fields';
import { immersiveSourceRecords, immersiveEditableRecords, variantEditableRecords } from './source-records';
import { projectShipPanel, type ShipImmersivePanel } from './ship/ship-panel';
import { projectWeaponPanel, updateImmersiveWeaponField, type WeaponPanel } from './weapon/weapon-panel';
import { jointObject } from '@/domain/joint-edit';
import { projectWingPanel, type WingPanel } from './wing/wing-panel';
import { projectVariantPanel, type VariantPanel } from './variant/variant-panel';
import { variantWeaponGroups } from './variant/variant-actions';
import { isRowData } from '@/shared/lib/row-data';

export type ImmersivePanel = ShipImmersivePanel | WeaponPanel | WingPanel | VariantPanel;
export type ImmersiveEditorKind = 'ship' | 'weapon' | 'wing' | 'variant';

const definitions: Record<ImmersiveEditorKind, ImmersiveEditorDefinition<ImmersivePanel>> = {
  variant: {
    retainDisplayReferences: true,
    label: '装配',
    editableRecords: variantEditableRecords,
    project: projectVariantPanel,
    references: (_snapshot, values) =>
      Object.entries(values).map(([key, value]) => {
        const data = jointObject(value);
        const weapons = variantWeaponGroups(data)
          .flatMap((group) => Object.entries(isRowData(group.weapons) ? group.weapons : {}))
          .sort(([left], [right]) => left.localeCompare(right));
        const mods = [
          ...new Set(
            ['hullMods', 'permaMods', 'sMods']
              .flatMap((field) => (Array.isArray(data[field]) ? data[field] : []))
              .filter((id): id is string => typeof id === 'string'),
          ),
        ].sort();
        return [key, data.hullId, data.modules, weapons, data.wings, mods];
      }),
    media: () => [],
  },
  wing: {
    retainDisplayReferences: false,
    label: '战机联队',
    editableRecords: immersiveEditableRecords,
    project: projectWingPanel,
    references: (_snapshot, values) => Object.entries(values),
    media: (panel) => (panel.kind === 'wing' && panel.sprite ? [panel.sprite] : []),
  },
  ship: {
    retainDisplayReferences: false,
    label: '舰船',
    editableRecords: immersiveEditableRecords,
    project: projectShipPanel,
    references: (snapshot, values) => {
      const csv = jointObject(values[immersiveSourceRecords(snapshot).csv.key]);
      return [csv['system id'], csv['shield type'], csv['defense id']];
    },
    media: (panel) => (panel.kind === 'ship' && panel.sprite ? [panel.sprite] : []),
  },
  weapon: {
    retainDisplayReferences: false,
    updateField: updateImmersiveWeaponField,
    label: '武器',
    editableRecords: immersiveEditableRecords,
    project: projectWeaponPanel,
    references: (snapshot, values) => {
      const records = immersiveSourceRecords(snapshot),
        spec = jointObject(values[records.spec.key]),
        csv = jointObject(values[records.csv.key]);
      return [spec.projectileSpecId, spec.specClass, ...Object.entries(spec).filter(([key]) => key.endsWith('Sprite')), csv.type];
    },
    media: (panel) =>
      panel.kind === 'weapon'
        ? [
            ...panel.iconLayers.map((layer) => layer.resource),
            ...(panel.damageIcon ? [panel.damageIcon] : []),
            ...(panel.loadedMissile ? [panel.loadedMissile.resource] : []),
          ]
        : [],
  },
};
export function immersiveDefinition(kind: ImmersiveEditorKind): ImmersiveEditorDefinition<ImmersivePanel> {
  return definitions[kind];
}
