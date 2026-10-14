import { snapToStep } from './editor-constants';
import { arr, num, str } from '@/shared/lib/starsector';
import type { RowData } from '@/shared/types';

/// Canonical default fill for a weapon slot copied/created on the canvas;
/// the preview ghost and the persisted slot must never diverge.
export function weaponSlotWithDefaults(source: RowData, id: string, locations: number[]): RowData {
  return {
    ...source,
    id,
    size: str(source.size, 'MEDIUM'),
    type: str(source.type, 'BALLISTIC'),
    mount: str(source.mount, 'TURRET'),
    arc: num(source.arc, 120),
    angle: num(source.angle, 0),
    locations,
  };
}

/// Launch bays are fixed-shape slots; only the id and position vary.
export function launchBayWithDefaults(source: RowData, id: string, locations: number[]): RowData {
  return {
    ...source,
    id,
    size: 'LARGE',
    type: 'LAUNCH_BAY',
    mount: 'HIDDEN',
    arc: 360,
    angle: 0,
    locations,
  };
}

/// A launch bay's ports are the coordinate pairs inside `locations` (the game
/// ships bays with one pair per launch position); an odd trailing number is
/// dropped so pairs stay intact.
export function bayPorts(locations: unknown): number[][] {
  const source = Array.isArray(locations) ? locations : [];
  const ports: number[][] = [];
  for (let index = 0; index + 1 < source.length; index += 2) {
    ports.push([Number(source[index]) || 0, Number(source[index + 1]) || 0]);
  }
  return ports;
}

export function appendBayPort(locations: unknown, coord: number[]): number[] {
  const ports = bayPorts(locations);
  ports.push([coord[0] || 0, coord[1] || 0]);
  return ports.flat();
}

export function updateBayPort(locations: unknown, portIndex: number, coord: number[]): number[] {
  const ports = bayPorts(locations);
  if (!ports[portIndex]) return ports.flat();
  ports[portIndex] = [coord[0] || 0, coord[1] || 0];
  return ports.flat();
}

export function removeBayPort(locations: unknown, portIndex: number): number[] {
  const ports = bayPorts(locations);
  if (!ports[portIndex]) return ports.flat();
  ports.splice(portIndex, 1);
  return ports.flat();
}

export function engineWithDefaults(source: RowData, location: number[]): RowData {
  return {
    ...source,
    angle: num(source.angle, 180),
    contrailSize: num(source.contrailSize, 12),
    length: num(source.length, 30),
    width: num(source.width, 10),
    location,
    style: str(source.style, 'LOW_TECH'),
  };
}

/// Weapon slot ids are `WS####`, zero-padded to four digits.
export function formatWeaponSlotId(index: number): string {
  return `WS${String(index).padStart(4, '0')}`;
}

/// Launch bay ids are `LB N` with a space separator (game-facing format).
export function formatLaunchBayId(index: number): string {
  return `LB ${index}`;
}

/// Smallest unused id ≥ 1 for the given format; falls back past the scanned
/// range when every candidate is taken.
export function shiftRelativePosition(value: RowData[string] | undefined, dxAbsolute: number, dyAbsolute: number) {
  // Multi-port launch bays keep every coordinate pair in `locations`; only an
  // odd trailing number is dropped.
  const source = Array.isArray(value) ? value : [];
  const shifted: number[] = [];
  for (let index = 0; index + 1 < source.length; index += 2) {
    shifted.push(snapToStep((Number(source[index]) || 0) - dyAbsolute), snapToStep((Number(source[index + 1]) || 0) + dxAbsolute));
  }
  if (!shifted.length) return [snapToStep(-dyAbsolute), snapToStep(dxAbsolute)];
  return shifted;
}
export function shipEngineSize(point: number[], engine: RowData) {
  const origin = arr(engine.location, [0, 0]);
  const angle = (num(engine.angle, 0) * Math.PI) / 180;
  const dx = (point[0] || 0) - (origin[0] || 0);
  const dy = (point[1] || 0) - (origin[1] || 0);
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  const across = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return {
    length: Math.max(8, Math.round(Math.abs(along)) || num(engine.length, 20)),
    width: Math.max(4, Math.round(Math.abs(across) * 2) || num(engine.width, 10)),
  };
}
