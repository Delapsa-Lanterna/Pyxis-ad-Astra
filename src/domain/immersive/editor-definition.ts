import type { JointEditSnapshot, JointValue, ResourceRef } from '@/shared/types';
import { immersiveSourceRecords, immersiveEditableRecords } from './source-records';
import { projectShipPanel, type ShipImmersivePanel } from './ship-panel';
import { projectWeaponPanel, type WeaponPanel } from './weapon-panel';
import { jointObject } from '@/domain/joint-edit';
import { projectWingPanel, type WingPanel } from './wing-panel';

export type ImmersivePanel = ShipImmersivePanel | WeaponPanel | WingPanel;
export type ImmersiveEditorKind = 'ship' | 'weapon' | 'wing';
export interface ImmersiveEditorDefinition {
  label: string;
  editableRecords: (snapshot: JointEditSnapshot) => string[];
  project: (snapshot: JointEditSnapshot, values: Record<string, JointValue>, projection: JointEditSnapshot | null) => ImmersivePanel;
  references: (snapshot: JointEditSnapshot, values: Record<string, JointValue>) => unknown[];
  media: (panel: ImmersivePanel) => ResourceRef[];
}
const definitions: Record<ImmersiveEditorKind, ImmersiveEditorDefinition> = {
  wing: {
    label: '战机',
    editableRecords: immersiveEditableRecords,
    project: projectWingPanel,
    references: (_snapshot, values) => Object.entries(values),
    media: (panel) => (panel.kind === 'wing' && panel.sprite ? [panel.sprite] : []),
  },
  ship: {
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
export function immersiveDefinition(kind: ImmersiveEditorKind): ImmersiveEditorDefinition {
  return definitions[kind];
}
