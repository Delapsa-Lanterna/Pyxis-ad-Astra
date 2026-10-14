import type { RowData } from '@/shared/types';
import type {
  CanvasInput,
  CanvasModifiers,
  EditorTarget,
  Point,
  ShipEditorMode,
  ShipHoverPreview,
  ShipSlotGeometry,
  ShipEngineGeometry,
} from './editor-types';
import { arr, deepClone, num, str } from '@/shared/lib/starsector';
import { distance, nearestBoundsSegment, pointAngle, pointArc, shipRelativeToAbsolute, shipAbsoluteToRelative } from './lib/geometry';
import { snapToStep } from './lib/editor-constants';
import {
  bayPorts,
  appendBayPort,
  updateBayPort,
  removeBayPort,
  shipEngineSize,
  shiftRelativePosition,
  weaponSlotWithDefaults,
  launchBayWithDefaults,
  engineWithDefaults,
  formatWeaponSlotId,
  formatLaunchBayId,
} from './lib/ship-slots';
import { nextFormattedId } from '@/shared/lib/next-formatted-id';
import {
  findMirrorWeaponSlotIndex,
  findMirrorEngineIndex,
  findMirrorBoundIndex,
  mirrorOffsetPoint,
  mirrorBayPort,
  mirrorWeaponSlotForAdd,
  mirrorEngineForAdd,
  mirrorAngleDeg,
  MIRROR_EPSILON,
} from './lib/mirror';

function shipCollections(ship: RowData) {
  return {
    center: arr(ship.center, [0, 0]),
    shieldCenter: arr(ship.shieldCenter, [0, 0]),
    collisionRadius: num(ship.collisionRadius),
    shieldRadius: num(ship.shieldRadius),
    bounds: ship.bounds as number[],
    slots: ship.weaponSlots as RowData[],
    engines: ship.engineSlots as RowData[],
  };
}

export function projectShipGeometry(ship: RowData) {
  const g = shipCollections(ship);
  return {
    ...g,
    slots: g.slots.map((slot): ShipSlotGeometry => {
      const type = str(slot.type, 'SYSTEM').toUpperCase();
      return {
        type,
        size: str(slot.size, 'MEDIUM').toUpperCase(),
        mount: str(slot.mount),
        angle: num(slot.angle),
        arc: num(slot.arc),
        locations: type === 'LAUNCH_BAY' ? bayPorts(slot.locations).flat() : arr(slot.locations, [0, 0]),
      };
    }),
    engines: g.engines.map((engine): ShipEngineGeometry => ({
      angle: num(engine.angle),
      length: num(engine.length, 20),
      width: num(engine.width, 10),
      location: arr(engine.location, [0, 0]),
    })),
  };
}
export type ShipGeometry = ReturnType<typeof projectShipGeometry>;

export type ShipOperationKind =
  | 'center'
  | 'shield'
  | 'collisionRadius'
  | 'shieldRadius'
  | 'bound'
  | 'weapon'
  | 'weaponAngle'
  | 'weaponArc'
  | 'launchBayPort'
  | 'engine'
  | 'engineAngle'
  | 'engineSize'
  | 'boundAppend'
  | 'boundInsert'
  | 'weaponCopy'
  | 'launchBayAdd'
  | 'launchBayPortAdd'
  | 'engineCopy';
export interface ShipGesture {
  kind: ShipOperationKind;
  target: EditorTarget;
  pair: EditorTarget | null;
}
export function shipOperationKind(mode: ShipEditorMode, m: CanvasModifiers, target: EditorTarget | null): ShipOperationKind | null {
  if (mode === 'overview') return null;
  if (mode === 'bounds') return m.shiftKey ? 'boundAppend' : m.ctrlKey ? 'boundInsert' : target ? 'bound' : null;
  if (mode === 'launchBay') return m.ctrlKey ? 'launchBayAdd' : m.shiftKey ? 'launchBayPortAdd' : target ? 'launchBayPort' : null;
  if (mode === 'weapon') return m.shiftKey ? 'weaponCopy' : target ? (m.altKey ? 'weaponArc' : m.ctrlKey ? 'weapon' : 'weaponAngle') : null;
  if (mode === 'engine')
    return m.shiftKey ? 'engineCopy' : target ? (m.altKey ? 'engineSize' : m.ctrlKey ? 'engine' : 'engineAngle') : null;
  return m.shiftKey ? 'collisionRadius' : m.ctrlKey ? 'shieldRadius' : target?.kind === 'shield' ? 'shield' : target ? 'center' : null;
}
export function shipPreviewTakesOver(mode: ShipEditorMode, m: CanvasModifiers) {
  return mode !== 'overview' && (m.shiftKey || m.ctrlKey || (m.altKey && (mode === 'weapon' || mode === 'engine')));
}
export function nextShipSlotId(ship: RowData, bay = false) {
  const slots = ship.weaponSlots as RowData[];
  const used = new Set(
    slots
      .filter((slot) => (bay ? str(slot.type).toUpperCase() === 'LAUNCH_BAY' : true))
      .map((slot) => str(slot.id))
      .filter((id) => (bay ? /^LB \d+$/.test(id) : /^WS\d{4}$/.test(id))),
  );
  return nextFormattedId(used, bay ? formatLaunchBayId : formatWeaponSlotId);
}
export function addShipElement(
  ship: RowData,
  kind: 'weapon' | 'launchBay' | 'engine' | 'bound',
  point: number[],
  mirror: boolean,
  source: RowData = {},
): { target: EditorTarget; pair: EditorTarget | null } {
  const g = shipCollections(ship);
  if (kind === 'bound') {
    const i = g.bounds.length / 2;
    g.bounds.push(...point);
    const paired = mirror && Math.abs(point[1] || 0) > MIRROR_EPSILON;
    if (paired) g.bounds.push(...mirrorOffsetPoint(point));
    return { target: { kind: 'bound', i }, pair: paired ? { kind: 'bound', i: i + 1 } : null };
  }
  const engine = kind === 'engine',
    bay = kind === 'launchBay',
    items = engine ? g.engines : g.slots,
    i = items.length;
  const created = engine
    ? engineWithDefaults(source, point)
    : bay
      ? launchBayWithDefaults(source, nextShipSlotId(ship, true), point)
      : weaponSlotWithDefaults(source, nextShipSlotId(ship), point);
  items.push(created);
  const paired = mirror && Math.abs(point[1] || 0) > MIRROR_EPSILON;
  if (paired) items.push(engine ? mirrorEngineForAdd(created) : { ...mirrorWeaponSlotForAdd(created), id: nextShipSlotId(ship, bay) });
  return {
    target: { kind: engine ? 'engine' : bay ? 'launchBayPort' : 'weapon', i, ...(bay ? { port: 0 } : {}) },
    pair: paired ? { kind: engine ? 'engine' : 'weapon', i: i + 1 } : null,
  };
}
export function shipMirrorTarget(ship: RowData, target: EditorTarget, mirror: boolean): EditorTarget | null {
  if (!mirror || target.kind === 'center' || target.kind === 'shield') return null;
  const g = shipCollections(ship);
  const i =
    target.kind === 'bound'
      ? findMirrorBoundIndex(g.bounds, target.i)
      : target.kind === 'engine'
        ? findMirrorEngineIndex(g.engines, target.i)
        : findMirrorWeaponSlotIndex(g.slots, target.i);
  return i === null ? null : { kind: target.kind === 'launchBayPort' ? 'weapon' : target.kind, i };
}
export function beginShipOperation(
  ship: RowData,
  kind: ShipOperationKind,
  target: EditorTarget | null,
  absolute: number[],
  mirror: boolean,
): ShipGesture | null {
  const g = shipCollections(ship),
    relative = shipAbsoluteToRelative(absolute, g.center).map((v) => snapToStep(v));
  if (kind === 'collisionRadius' || kind === 'shieldRadius')
    return { kind, target: { kind: kind === 'collisionRadius' ? 'center' : 'shield', i: 0 }, pair: null };
  if (kind === 'weaponCopy' || kind === 'launchBayAdd' || kind === 'engineCopy') {
    const engine = kind === 'engineCopy',
      bay = kind === 'launchBayAdd';
    const source = target ? (engine ? g.engines[target.i]! : g.slots[target.i]!) : {};
    return {
      kind: engine ? 'engine' : bay ? 'launchBayPort' : 'weapon',
      ...addShipElement(ship, engine ? 'engine' : bay ? 'launchBay' : 'weapon', relative, mirror, bay ? {} : deepClone(source)),
    };
  }
  if (kind === 'boundAppend') return { kind: 'bound', ...addShipElement(ship, 'bound', relative, mirror) };
  if (kind === 'boundInsert') {
    const at = (nearestBoundsSegment(g.bounds, relative) + 1) * 2,
      paired = mirror && Math.abs(relative[1] || 0) > MIRROR_EPSILON;
    g.bounds.splice(at, 0, ...relative);
    if (paired) g.bounds.splice(at + 2, 0, ...mirrorOffsetPoint(relative));
    return { kind: 'bound', target: { kind: 'bound', i: at / 2 }, pair: paired ? { kind: 'bound', i: at / 2 + 1 } : null };
  }
  if (kind === 'launchBayPortAdd') {
    if (!target || str(g.slots[target.i]!.type).toUpperCase() !== 'LAUNCH_BAY') return null;
    const slot = g.slots[target.i]!,
      port = bayPorts(slot.locations).length;
    slot.locations = appendBayPort(slot.locations, relative);
    if (mirror && Math.abs(relative[1] || 0) > MIRROR_EPSILON) slot.locations = appendBayPort(slot.locations, mirrorBayPort(relative));
    return { kind: 'launchBayPort', target: { kind: 'launchBayPort', i: target.i, port }, pair: null };
  }
  if (!target) return null;
  return { kind, target, pair: shipMirrorTarget(ship, target, mirror) };
}
export function moveShipCenter(ship: RowData, center: number[]) {
  const g = shipCollections(ship),
    dx = (center[0] || 0) - (g.center[0] || 0),
    dy = (center[1] || 0) - (g.center[1] || 0);
  ship.center = center;
  ship.shieldCenter = shiftRelativePosition(ship.shieldCenter, dx, dy);
  for (const slot of g.slots) slot.locations = shiftRelativePosition(slot.locations, dx, dy);
  for (const engine of g.engines) engine.location = shiftRelativePosition(engine.location, dx, dy);
  for (let i = 0; i < g.bounds.length; i += 2) {
    g.bounds[i] = snapToStep((g.bounds[i] || 0) - dy);
    g.bounds[i + 1] = snapToStep((g.bounds[i + 1] || 0) + dx);
  }
}
export function updateShipOperation(ship: RowData, gesture: ShipGesture, absolute: number[]) {
  const g = shipCollections(ship),
    { kind, target, pair } = gesture;
  const snapped = absolute.map((v) => snapToStep(v)),
    relative = shipAbsoluteToRelative(snapped, g.center).map((v) => snapToStep(v));
  const slot = g.slots[target.i],
    engine = g.engines[target.i];
  if (kind === 'center') moveShipCenter(ship, snapped);
  else if (kind === 'shield') ship.shieldCenter = relative;
  else if (kind === 'collisionRadius') ship.collisionRadius = Math.max(0, Math.round(distance(absolute, g.center)));
  else if (kind === 'shieldRadius')
    ship.shieldRadius = Math.max(0, Math.round(distance(absolute, shipRelativeToAbsolute(g.shieldCenter, g.center))));
  else if (kind === 'bound') {
    g.bounds.splice(target.i * 2, 2, ...relative);
    if (pair) g.bounds.splice(pair.i * 2, 2, ...mirrorOffsetPoint(relative));
  } else if (kind === 'launchBayPort') slot!.locations = updateBayPort(slot!.locations, target.port!, relative);
  else if (kind === 'weapon' || kind === 'engine') {
    const source = kind === 'weapon' ? slot! : engine!,
      key = kind === 'weapon' ? 'locations' : 'location';
    source[key] = relative;
    if (pair) (kind === 'weapon' ? g.slots : g.engines)[pair.i]![key] = mirrorOffsetPoint(relative);
  } else if (kind === 'weaponAngle' || kind === 'engineAngle') {
    const source = kind === 'weaponAngle' ? slot! : engine!,
      key = kind === 'weaponAngle' ? 'locations' : 'location';
    source.angle = pointAngle(shipRelativeToAbsolute(arr(source[key], [0, 0]), g.center), absolute);
    if (pair) (kind === 'weaponAngle' ? g.slots : g.engines)[pair.i]!.angle = mirrorAngleDeg(num(source.angle));
  } else if (kind === 'weaponArc') {
    slot!.arc = pointArc(shipRelativeToAbsolute(arr(slot!.locations, [0, 0]), g.center), absolute, num(slot!.angle));
    if (pair) g.slots[pair.i]!.arc = slot!.arc;
  } else if (kind === 'engineSize') {
    const size = shipEngineSize(relative, engine!);
    Object.assign(engine!, size);
    if (pair) Object.assign(g.engines[pair.i]!, size);
  }
}
export function previewShipOperation(
  ship: RowData,
  mode: ShipEditorMode,
  target: EditorTarget | null,
  input: CanvasInput,
  absolute: number[],
  mirror: boolean,
): ShipHoverPreview {
  if (!shipPreviewTakesOver(mode, input)) return null;
  const kind = shipOperationKind(mode, input, target);
  if (!kind) return null;
  const original = shipCollections(ship);
  const candidate: RowData = {
    ...ship,
    weaponSlots: [...original.slots],
    engineSlots: [...original.engines],
    bounds: [...original.bounds],
  };
  const pair = target ? shipMirrorTarget(ship, target, mirror) : null;
  for (const item of [...(target ? [target] : []), ...(pair ? [pair] : [])]) {
    if (mode === 'weapon' || mode === 'launchBay') (candidate.weaponSlots as RowData[])[item.i] = { ...original.slots[item.i]! };
    if (mode === 'engine') (candidate.engineSlots as RowData[])[item.i] = { ...original.engines[item.i]! };
  }
  const gesture = beginShipOperation(
    candidate,
    kind,
    target,
    absolute.map((v) => snapToStep(v)),
    mirror,
  );
  if (!gesture) return null;
  updateShipOperation(candidate, gesture, absolute);
  const g = projectShipGeometry(candidate),
    i = gesture.target.i;
  if (kind === 'collisionRadius') return { kind, radius: num(candidate.collisionRadius) };
  if (kind === 'shieldRadius') return { kind, radius: num(candidate.shieldRadius) };
  if (kind === 'boundAppend') return { kind, coord: g.bounds.slice(i * 2, i * 2 + 2) };
  if (kind === 'boundInsert') return { kind, coord: g.bounds.slice(i * 2, i * 2 + 2), insertAfter: i - 1 };
  if (kind === 'weaponCopy' || kind === 'weapon' || kind === 'launchBayAdd')
    return { kind: kind === 'weapon' ? 'weaponMove' : kind, coord: arr(g.slots[i]!.locations, [0, 0]), slot: g.slots[i]! };
  if (kind === 'weaponArc') return { kind, arc: num(g.slots[i]!.arc) };
  if (kind === 'launchBayPortAdd') return { kind, coord: bayPorts(g.slots[i]!.locations)[gesture.target.port!]! };
  if (kind === 'engineCopy' || kind === 'engine')
    return { kind: kind === 'engine' ? 'engineMove' : kind, coord: arr(g.engines[i]!.location, [0, 0]), engine: g.engines[i]! };
  if (kind === 'engineSize') return { kind, length: num(g.engines[i]!.length), width: num(g.engines[i]!.width) };
  return null;
}
export function deleteShipElement(ship: RowData, target: EditorTarget, mirror: boolean) {
  const g = shipCollections(ship),
    pair = shipMirrorTarget(ship, target, mirror);
  const indexes = (pair ? [target.i, pair.i] : [target.i]).sort((a, b) => b - a);
  for (const i of indexes) {
    if (target.kind === 'bound') g.bounds.splice(i * 2, 2);
    else (target.kind === 'engine' ? g.engines : g.slots).splice(i, 1);
  }
}
export function removeShipPort(ship: RowData, slotIndex: number, port: number) {
  const slot = (ship.weaponSlots as RowData[])[slotIndex]!;
  const remaining = removeBayPort(slot.locations, port);
  if (remaining.length) slot.locations = remaining;
  else (ship.weaponSlots as RowData[]).splice(slotIndex, 1);
  return remaining.length ? Math.min(port, bayPorts(remaining).length - 1) : null;
}
export function shipTargets(g: ShipGeometry, mode: ShipEditorMode, toCanvas: (loc: number[]) => Point) {
  const targets: Array<EditorTarget & { point: Point; radius: number }> = [];
  const add = (kind: string, i: number, loc: number[], radius: number, port?: number) =>
    targets.push({ kind, i, port, point: toCanvas(loc), radius });
  if (mode === 'weapon' || mode === 'launchBay') {
    for (let i = g.slots.length - 1; i >= 0; i--) {
      const slot = g.slots[i]!,
        bay = str(slot.type).toUpperCase() === 'LAUNCH_BAY';
      if (mode === 'launchBay' && bay) {
        const ports = bayPorts(slot.locations);
        for (let port = ports.length - 1; port >= 0; port--) add('launchBayPort', i, ports[port]!, 16, port);
      }
      if (mode === 'weapon' && !bay) add('weapon', i, arr(slot.locations, [0, 0]), 26);
    }
  } else if (mode === 'engine') for (let i = g.engines.length - 1; i >= 0; i--) add('engine', i, arr(g.engines[i]!.location, [0, 0]), 28);
  else if (mode === 'bounds') for (let i = 0; i < g.bounds.length; i += 2) add('bound', i / 2, g.bounds.slice(i, i + 2), 26);
  else if (mode === 'ranges') {
    add('shield', 0, g.shieldCenter, 30);
    add('center', 0, [0, 0], 30);
  }
  return targets;
}
