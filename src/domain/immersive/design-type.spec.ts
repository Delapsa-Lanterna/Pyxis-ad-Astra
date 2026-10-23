import { describe, it, expect } from 'vitest';
import { shipJointFixture } from '@/test/ship-joint-edit';
import { designTypeColor } from './design-type';
describe('original design manufacturer color', () => {
  it('uses game settings and retains the exact manufacturer original text', () => {
    const snapshot = shipJointFixture();
    snapshot.referenceSettings.values.designTypeColors = { 'Custom Mod': [10, 20, 30, 128] };
    expect(designTypeColor(snapshot, 'Custom Mod')).toBe('rgba(10,20,30,0.5019607843137255)');
    expect(designTypeColor(snapshot, 'Low Tech')).toBe('#d16e5b');
    expect(designTypeColor(snapshot, 'Common')).toBe('#bec8c8');
  });
});
