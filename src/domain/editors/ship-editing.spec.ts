import { describe, it, expect } from 'vitest';
import { normalizeShipSpec } from './lib/normalize';

import { shipRelativeToAbsolute } from './lib/geometry';
import {
  projectShipGeometry,
  shipOperationKind,
  previewShipOperation,
  beginShipOperation,
  updateShipOperation,
  moveShipCenter,
  deleteShipElement,
  addShipElement,
  removeShipPort,
  shipTargets,
} from './ship-editing';
import type { RowData } from '@/shared/types';
import type { CanvasInput } from './editor-types';

function ship() {
  return normalizeShipSpec({
    hullId: 'ship',
    center: [10, 20],
    shieldCenter: [5, 10],
    collisionRadius: 40,
    shieldRadius: 30,
    bounds: [0, 20, 10, 20, 10, -20],
    custom: { keep: true },
    weaponSlots: [
      {
        id: 'WS0001',
        type: 'BALLISTIC',
        size: 'MEDIUM',
        mount: 'TURRET',
        angle: 30,
        arc: 120,
        locations: [30, 40],
        custom: { name: 'source' },
      },
      { id: 'WS0002', type: 'BALLISTIC', size: 'MEDIUM', mount: 'TURRET', angle: 330, arc: 120, locations: [30, -40] },
      { id: 'LB 1', type: 'LAUNCH_BAY', size: 'LARGE', locations: [0, 0, 2, 3] },
    ],
    engineSlots: [
      { angle: 180, length: 30, width: 10, location: [7, 8] },
      { angle: 180, length: 30, width: 10, location: [7, -8] },
    ],
  });
}
const input = (patch: Partial<CanvasInput> = {}): CanvasInput => ({
  point: { x: 0, y: 0 },
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  ...patch,
});

describe('ship edit operations', () => {
  it.each(['collisionRadius', 'shieldRadius'] as const)('previews and edits %s before a pointer target has been selected', (kind) => {
    const source = ship(),
      absolute = [20, 30],
      keys = input(kind === 'collisionRadius' ? { shiftKey: true } : { ctrlKey: true });
    const preview = previewShipOperation(source, 'ranges', null, keys, absolute, false);
    expect(preview?.kind).toBe(kind);
    const gesture = beginShipOperation(source, kind, null, absolute, false)!;
    updateShipOperation(source, gesture, absolute);
    if (preview?.kind === 'collisionRadius' || preview?.kind === 'shieldRadius') expect(source[kind]).toBe(preview.radius);
  });

  it.each([
    ['overview', null],
    ['ranges', 'center'],
    ['bounds', 'bound'],
    ['weapon', 'weaponAngle'],
    ['launchBay', 'launchBayPort'],
    ['engine', 'engineAngle'],
  ] as const)('resolves the ordinary %s operation', (mode, expected) => {
    const kind =
      mode === 'engine'
        ? 'engine'
        : mode === 'bounds'
          ? 'bound'
          : mode === 'launchBay'
            ? 'launchBayPort'
            : mode === 'weapon'
              ? 'weapon'
              : 'center';
    expect(shipOperationKind(mode, input(), { kind, i: 0, port: 0 })).toBe(expected);
  });
  it.each(['weapon', 'engine'] as const)('uses the same copy operation for a combined-key %s preview and gesture', (mode) => {
    const source = ship(),
      target = { kind: mode, i: 0 },
      keys = input({ shiftKey: true, ctrlKey: true, altKey: true });
    const absolute = shipRelativeToAbsolute([12, 18], [10, 20]),
      before = JSON.stringify(source);
    const preview = previewShipOperation(source, mode, target, keys, absolute, true)!;
    expect(preview.kind).toBe(mode === 'weapon' ? 'weaponCopy' : 'engineCopy');
    expect(JSON.stringify(source)).toBe(before);
    const operation = beginShipOperation(source, shipOperationKind(mode, keys, target)!, target, absolute, true)!;
    updateShipOperation(source, operation, absolute);
    const g = projectShipGeometry(source);
    expect(mode === 'weapon' ? g.slots[operation.target.i]!.locations : g.engines[operation.target.i]!.location).toEqual([12, 18]);
    if (mode === 'weapon') expect((source.weaponSlots as RowData[])[operation.target.i]!.custom).toEqual({ name: 'source' });
    if (preview.kind === 'weaponCopy') expect(projectShipGeometry(source).slots[operation.target.i]).toEqual(preview.slot);
    if (preview.kind === 'engineCopy') expect(projectShipGeometry(source).engines[operation.target.i]).toEqual(preview.engine);
    expect(mode === 'weapon' ? g.slots[operation.pair!.i]!.locations : g.engines[operation.pair!.i]!.location).toEqual([12, -18]);
  });
  it('preserves absolute geometry while moving the center and preserves relative geometry when setting its field', () => {
    const source = ship(),
      g = projectShipGeometry(source);
    const position = shipRelativeToAbsolute(g.slots[0]!.locations as number[], g.center);
    moveShipCenter(source, [15, 25]);
    const moved = projectShipGeometry(source);
    expect(shipRelativeToAbsolute(moved.slots[0]!.locations as number[], moved.center)).toEqual(position);
    expect(source.shieldCenter).toEqual([0, 15]);
    expect(source.custom).toEqual({ keep: true });
    const values = ship(),
      relative = (values.weaponSlots as RowData[])[0]!.locations;
    values.center = [15, 25];
    expect((values.weaponSlots as RowData[])[0]!.locations).toEqual(relative);
  });
  it('updates paired weapon position, angle and arc then deletes the current pair', () => {
    const source = ship(),
      target = { kind: 'weapon', i: 0 },
      absolute = shipRelativeToAbsolute([12, 18], [10, 20]);
    const move = beginShipOperation(source, 'weapon', target, absolute, true)!;
    updateShipOperation(source, move, absolute);
    expect((source.weaponSlots as RowData[]).slice(0, 2).map((x) => x.locations)).toEqual([
      [12, 18],
      [12, -18],
    ]);
    const rotate = beginShipOperation(source, 'weaponAngle', target, absolute, true)!;
    updateShipOperation(source, rotate, [-9, 32]);
    expect((source.weaponSlots as RowData[]).slice(0, 2).map((x) => x.angle)).toEqual([90, 270]);
    const arc = beginShipOperation(source, 'weaponArc', target, absolute, true)!;
    updateShipOperation(source, arc, [-8, 33]);
    const slots = source.weaponSlots as RowData[];
    expect(slots[1]!.arc).toBe(slots[0]!.arc);
    deleteShipElement(source, target, true);
    expect((source.weaponSlots as RowData[]).map((x) => x.id)).toEqual(['LB 1']);
  });
  it('inserts into the same bounds segment shown by the preview', () => {
    const source = ship(),
      keys = input({ ctrlKey: true }),
      absolute = shipRelativeToAbsolute([5, 21], [10, 20]);
    const preview = previewShipOperation(source, 'bounds', { kind: 'bound', i: 0 }, keys, absolute, true)!;
    expect(preview.kind).toBe('boundInsert');
    const gesture = beginShipOperation(source, 'boundInsert', { kind: 'bound', i: 0 }, absolute, true)!;
    updateShipOperation(source, gesture, absolute);
    if (preview.kind === 'boundInsert')
      expect((source.bounds as number[]).slice((preview.insertAfter + 1) * 2, (preview.insertAfter + 2) * 2)).toEqual(preview.coord);
    expect((source.bounds as number[]).slice(gesture.pair!.i * 2, gesture.pair!.i * 2 + 2)).toEqual([5, -21]);
  });
  it('adds paired ports inside one bay, addresses the exact port and removes the final bay', () => {
    const source = ship(),
      target = { kind: 'launchBayPort', i: 2, port: 1 },
      absolute = shipRelativeToAbsolute([8, 9], [10, 20]);
    const gesture = beginShipOperation(source, 'launchBayPortAdd', target, absolute, true)!;
    updateShipOperation(source, gesture, absolute);
    expect((source.weaponSlots as RowData[])[2]!.locations).toEqual([0, 0, 2, 3, 8, 9, 8, -9]);
    removeShipPort(source, 2, 3);
    removeShipPort(source, 2, 2);
    removeShipPort(source, 2, 1);
    expect(removeShipPort(source, 2, 0)).toBeNull();
    expect((source.weaponSlots as RowData[]).map((x) => x.id)).toEqual(['WS0001', 'WS0002']);
  });
  it('captures paired engines for size changes and keeps centerline additions single', () => {
    const source = ship(),
      target = { kind: 'engine', i: 0 },
      absolute = shipRelativeToAbsolute([-33, 14], [10, 20]);
    const gesture = beginShipOperation(source, 'engineSize', target, absolute, true)!;
    updateShipOperation(source, gesture, absolute);
    expect((source.engineSlots as RowData[]).map((x) => [x.length, x.width])).toEqual([
      [40, 12],
      [40, 12],
    ]);
    const added = addShipElement(source, 'weapon', [12, 0], true);
    expect(added.pair).toBeNull();
    expect((source.weaponSlots as RowData[]).length).toBe(4);
  });
  it('provides the existing target order for overlapping ports', () => {
    const g = projectShipGeometry(ship()),
      targets = shipTargets(g, 'launchBay', (p) => ({ x: p[0]!, y: p[1]! }));
    expect(targets.map((x) => x.port)).toEqual([1, 0]);
  });
});
