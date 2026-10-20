export interface Point {
  x: number;
  y: number;
}

export type ShipEditorMode = 'overview' | 'ranges' | 'bounds' | 'weapon' | 'launchBay' | 'engine';
export type ShipHoverPreview =
  | { kind: 'collisionRadius'; radius: number }
  | { kind: 'shieldRadius'; radius: number }
  | { kind: 'boundAppend'; coord: number[] }
  | { kind: 'boundInsert'; coord: number[]; insertAfter: number }
  | { kind: 'weaponCopy'; coord: number[]; slot: ShipSlotGeometry }
  | { kind: 'weaponMove'; coord: number[]; slot: ShipSlotGeometry }
  | { kind: 'weaponArc'; arc: number }
  | { kind: 'launchBayAdd'; coord: number[]; slot: ShipSlotGeometry }
  | { kind: 'launchBayPortAdd'; coord: number[] }
  | { kind: 'engineCopy'; coord: number[]; engine: ShipEngineGeometry }
  | { kind: 'engineMove'; coord: number[]; engine: ShipEngineGeometry }
  | { kind: 'engineSize'; length: number; width: number }
  | null;
export type WeaponOperationPreview = { kind: 'add'; coord: { x: number; y: number } } | { kind: 'angle'; angle: number } | null;

export interface EditorTarget {
  kind: string;
  i: number;
  port?: number;
}
export interface CanvasTarget extends EditorTarget {
  distance: number;
}
export interface CanvasModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}
export interface CanvasInput extends CanvasModifiers {
  point: Point;
}

export interface ShipSlotGeometry {
  angle: number;
  arc: number;
  mount: string;
  type: string;
  size: string;
  locations: number[];
}
export interface ShipEngineGeometry {
  styleId?: import('@/shared/types').RowData[string];
  style?: import('@/shared/types').RowData[string];
  styleSpec?: import('@/shared/types').RowData[string];
  angle: number;
  length: number;
  width: number;
  location: number[];
}
