import { describe, expect, it } from 'vitest';
import type { ResourceRef } from '@/shared/types';
import type { MountedWeaponImages } from '@/domain/editors/weapon-images';
import { createCanvasRecorder } from '@/test/canvas-recorder';
import { renderMountedWeapons, type MountedWeaponScene } from './weapon-images';

const resource = (key: string): ResourceRef => ({ key, source: 'mod', relPath: key + '.png', ownerKind: 'weapon', ownerId: key });
const image = (key: string) => ({ width: 10, height: 20, name: key }) as unknown as HTMLImageElement;
const normal: MountedWeaponImages = {
  slot: { id: 'normal', type: 'BALLISTIC', mount: 'TURRET', locations: [0, 0], angle: 0 },
  renderOrder: 0,
  layers: [
    { resource: resource('normal-under'), origin: { x: 0.5, y: 0.5 }, phase: 'under' },
    { resource: resource('normal-body'), origin: { x: 0.5, y: 0.5 }, phase: 'body' },
  ],
  loadedMissile: null,
  additive: false,
};
const decorative: MountedWeaponImages = {
  ...normal,
  slot: { ...normal.slot, id: 'deco', type: 'DECORATIVE' },
  renderOrder: 100000,
  layers: [
    { resource: resource('deco-under'), origin: { x: 0.5, y: 0.75 }, phase: 'under' },
    { resource: resource('deco-body'), origin: { x: 0.5, y: 0.75 }, phase: 'body' },
  ],
  additive: true,
};

describe('mounted weapon canvas passes', () => {
  it.each(['combat', 'refit'] as const)('uses the %s passes with every under layer before the bodies', (context) => {
    const recording = createCanvasRecorder();
    const bitmaps = new Map(['normal-under', 'normal-body', 'deco-under', 'deco-body', 'module'].map((key) => [key, image(key)]));
    const weapons = [decorative, normal];
    renderMountedWeapons(recording.ctx, {
      weapons,
      image: (resource) => bitmaps.get(resource.key),
      point: () => ({ x: 50, y: 60 }),
      rotation: () => Math.PI / 4,
      scale: 2,
      context,
      renderModules: () => {
        recording.ctx.drawImage(bitmaps.get('module')!, 0, 0);
      },
    });
    const draws = recording.calls('drawImage');
    expect(draws.map((draw) => draw.args[0])).toEqual(
      (context === 'combat'
        ? ['normal-under', 'deco-under', 'normal-body', 'deco-body']
        : ['normal-under', 'deco-under', 'deco-body', 'module', 'normal-body']
      ).map((key) => bitmaps.get(key)),
    );
    expect(draws.filter((draw) => draw.args[0] === bitmaps.get('deco-body')).map((draw) => draw.composite)).toEqual(['lighter']);
    expect(draws[0]!.args.slice(-4)).toEqual([-10, -20, 20, 40]);
    expect(draws[1]!.args.slice(-4)).toEqual([-10, -30, 20, 40]);
    expect(recording.calls('rotate').every((op) => op.args[0] === Math.PI / 4)).toBe(true);
    expect(weapons.map((weapon) => weapon.slot.id)).toEqual(['deco', 'normal']);
    expect(recording.ctx.globalCompositeOperation).toBe('source-over');
  });
  it('draws hidden loaded missiles at their projected offsets after the body phase', () => {
    const recording = createCanvasRecorder(),
      bitmap = image('missile');
    const weapon: MountedWeaponImages = {
      ...normal,
      slot: { ...normal.slot, mount: 'HIDDEN' },
      layers: [],
      additive: true,
      loadedMissile: { resource: resource('missile'), size: [12, 24], center: [6, 8], offsets: [5, 1, 10, 2], angles: [15, 30] },
    };
    const scene: MountedWeaponScene = {
      weapons: [weapon],
      image: () => bitmap,
      point: () => ({ x: 100, y: 200 }),
      rotation: () => Math.PI / 2,
      scale: 0.5,
      context: 'combat',
      renderModules: () => {},
    };
    renderMountedWeapons(recording.ctx, scene);
    expect(recording.calls('drawImage').map((op) => op.args.slice(-4))).toEqual([
      [-6, -16, 12, 24],
      [-6, -16, 12, 24],
    ]);
    expect(recording.calls('translate').map((op) => op.args)).toContainEqual([-1, -5]);
    expect(recording.calls('translate').map((op) => op.args)).toContainEqual([-2, -10]);
    expect(recording.calls('scale')[0]!.args).toEqual([0.5, 0.5]);
    expect(recording.calls('drawImage').every((op) => op.composite === 'lighter')).toBe(true);
  });
  it('renders available layers when another bitmap is missing', () => {
    const recording = createCanvasRecorder(),
      bitmap = image('normal-body');
    renderMountedWeapons(recording.ctx, {
      weapons: [normal],
      image: (resource) => (resource.key === 'normal-body' ? bitmap : undefined),
      point: () => ({ x: 0, y: 0 }),
      rotation: () => 0,
      scale: 1,
      context: 'combat',
      renderModules: () => {},
    });
    expect(recording.calls('drawImage').map((op) => op.args[0])).toEqual([bitmap]);
  });
});
