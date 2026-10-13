import type { RowData } from '@/shared/types';

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
  | { kind: 'weaponCopy'; coord: number[]; slot: RowData }
  | { kind: 'weaponMove'; coord: number[]; slot: RowData }
  | { kind: 'weaponArc'; arc: number }
  | { kind: 'launchBayAdd'; coord: number[]; slot: RowData }
  | { kind: 'launchBayPortAdd'; coord: number[] }
  | { kind: 'engineCopy'; coord: number[]; engine: RowData }
  | { kind: 'engineMove'; coord: number[]; engine: RowData }
  | { kind: 'engineSize'; length: number; width: number }
  | null;
export type BarrelPreview = { kind: 'add'; coord: { x: number; y: number } } | { kind: 'angle'; angle: number } | null;
