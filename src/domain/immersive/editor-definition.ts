import type { JointEditSnapshot, JointValue, ResourceRef } from '@/shared/types';
import { immersiveSourceRecords, immersiveEditableRecords } from './source-records';
import { projectShipPanel, type ShipImmersivePanel } from './ship-panel';
import { projectWeaponPanel, type WeaponPanel } from './weapon-panel';
import { jointObject } from '@/domain/joint-edit';

export type ImmersivePanel = ShipImmersivePanel | WeaponPanel;
export interface ImmersiveEditorDefinition {
  label: string;
  editableRecords: (snapshot: JointEditSnapshot) => string[];
  project: (snapshot: JointEditSnapshot, values: Record<string, JointValue>, projection: JointEditSnapshot | null) => ImmersivePanel;
  references: (snapshot: JointEditSnapshot, values: Record<string, JointValue>) => unknown[];
  media: (panel: ImmersivePanel) => ResourceRef[];
}
const definitions: Record<'ship' | 'weapon', ImmersiveEditorDefinition> = {
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
export function immersiveDefinition(kind: 'ship' | 'weapon'): ImmersiveEditorDefinition {
  return definitions[kind];
}
