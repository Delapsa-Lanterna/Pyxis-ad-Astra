import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImmersiveFallbackIcon from './ImmersiveFallbackIcon.vue';
import kinetic from '@/assets/immersive/damage/kinetic.svg?raw';
import fighter from '@/assets/immersive/icons/fighter-blank.svg?raw';

describe('local immersive graphics', () => {
  it('keeps the empty deck marker at the top center', () => {
    const own = mount(ImmersiveFallbackIcon, { props: { kind: 'fighter', size: 64, label: 'Empty deck' } });
    const path = new DOMParser().parseFromString(fighter, 'image/svg+xml').querySelector('path[fill="currentColor"]')!;
    const points = [...path.getAttribute('d')!.matchAll(/\d+/g)].map(Number);
    expect(points.filter((_, index) => index % 2 === 1).every((value) => value < 20)).toBe(true);
    expect(own.attributes('src')).toContain('data:image/svg+xml');
    own.unmount();
  });
  it.each(['KINETIC', 'HIGH_EXPLOSIVE', 'FRAGMENTATION', 'ENERGY', 'OTHER', 'hullmod', 'fighter'])(
    'draws %s at its requested size',
    (kind) => {
      const own = mount(ImmersiveFallbackIcon, { props: { kind, size: 80, label: 'Sample' } });
      expect(own.attributes('width')).toBe('80');
      expect(own.attributes('alt')).toBe('Sample');
      expect(own.attributes('src')).toContain('data:image/svg+xml');
      own.unmount();
    },
  );
  it('points the kinetic tip inward and reflects the body and impact across the diagonal', () => {
    const svg = new DOMParser().parseFromString(kinetic, 'image/svg+xml');
    const points = [
      ...svg
        .querySelector('path[fill="currentColor"]')!
        .getAttribute('d')!
        .matchAll(/(?:M|L)(\d+) (\d+)/g),
    ].map((point) => [Number(point[1]), Number(point[2])]);
    const tip = points.reduce((a, b) => (a[0]! < b[0]! ? a : b));
    const tail = points.reduce((a, b) => (a[0]! > b[0]! ? a : b));
    expect(tail[0]).toBeGreaterThan(60);
    expect(tail[1]).toBeLessThan(25);
    expect(tip[0]).toBeLessThan(40);
    expect(tip[1]).toBeGreaterThan(40);
    for (const path of svg.querySelectorAll('path[d]')) {
      const vertices = [...path.getAttribute('d')!.matchAll(/[ML](\d+) (\d+)/g)].map((p) => [+p[1]!, +p[2]!]);
      for (const [x, y] of vertices) expect(vertices).toContainEqual([80 - y!, 80 - x!]);
    }
  });
});
