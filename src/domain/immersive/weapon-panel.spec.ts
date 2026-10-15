import { describe, it, expect } from 'vitest';
import { weaponJointFixture } from '@/test/weapon-joint-edit';
import { jointFixtureValues } from '@/test/joint-edit';
import { jointObject } from '@/domain/joint-edit';
import { projectWeaponPanel } from './weapon-panel';
import { updateImmersiveField } from './fields';
import { highlightedTextParts } from './highlighted-text';

describe('weapon immersive field and display projection', () => {
  it.each(['customPrimary', 'customAncillary'] as const)('formats and highlights %s while retaining editable CSV text', (key) => {
    const snapshot = weaponJointFixture(),
      values = jointFixtureValues(snapshot);
    const text = '%s causes %s ~ %s times Effect damage.\nWith %s installed, damage increases by %s.';
    values.csv = {
      state: 'present',
      value: { ...jointObject(values.csv), [key]: text, [key + 'HL']: 'Effect | 0.4 | 0.6 | Example hullmod | 25%' },
    };
    const panel = projectWeaponPanel(snapshot, values);
    expect(panel[key]).toBe('Effect causes 0.4 ~ 0.6 times Effect damage.\nWith Example hullmod installed, damage increases by 25%.');
    expect(
      highlightedTextParts(panel[key], key === 'customPrimary' ? panel.customPrimaryHL : panel.customAncillaryHL)
        .filter((part) => part.highlight)
        .map((part) => part.text),
    ).toEqual(['Effect', '0.4', '0.6', 'Effect', 'Example hullmod', '25%']);
    expect(jointObject(values.csv)[key]).toBe(text);
  });
  it.each([
    ['%2$s then %s then %1$s', 'A | B', 'B then A then A', 'A | B'],
    ['%s damage; 100%% %n next', '25%', '25% damage; 100% \n next', '25%'],
    ['%s beams', '2 {x}', '2 × beams', '2 ×'],
    ['Literal 2 × beams', '2 {x}', 'Literal 2 × beams', '2 ×'],
    ['%s / %s', '25%', '25% / %s', '25%'],
    ['Raw %s %% %n', '', 'Raw %s %% %n', ''],
  ])('projects custom format %s', (text, highlights, expected, expectedHighlights) => {
    const snapshot = weaponJointFixture(),
      values = jointFixtureValues(snapshot);
    values.csv = { state: 'present', value: { ...jointObject(values.csv), customPrimary: text, customPrimaryHL: highlights } };
    const panel = projectWeaponPanel(snapshot, values);
    expect([panel.customPrimary, panel.customPrimaryHL]).toEqual([expected, expectedHighlights]);
    expect(jointObject(values.csv).customPrimaryHL).toBe(highlights);
  });
  it('projects mount identity, barrel ordering and loaded projectile source', () => {
    const snapshot = weaponJointFixture(),
      values = jointFixtureValues(snapshot);
    const source = (key: string) => ({
      source: 'mod' as const,
      ownerKind: 'weapon' as const,
      ownerId: 'chaingun',
      relPath: key + '.png',
      key,
    });
    snapshot.records[0]!.resourceRefs = {
      turretSprite: source('turretSprite'),
      turretGunSprite: source('turretGunSprite'),
      turretUnderSprite: source('turretUnderSprite'),
    };
    snapshot.records[3]!.resourceRefs = { sprite: source('sprite') };
    snapshot.records[3]!.value = { state: 'present', value: { specClass: 'missile', size: [12, 24], center: [6, 12] } };
    values.spec = {
      state: 'present',
      value: {
        ...jointObject(values.spec),
        visualRecoil: 1,
        renderHints: ['RENDER_BARREL_BELOW', 'RENDER_LOADED_MISSILES'],
        turretAngleOffsets: [0],
      },
    };
    const panel = projectWeaponPanel(snapshot, values);
    expect(panel.iconLayers.map((layer) => layer.resource.key)).toEqual(['turretUnderSprite', 'turretGunSprite', 'turretSprite']);
    expect(panel.mountType).toBe('BALLISTIC');
    expect(panel.mountSize).toBe('MEDIUM');
    expect(panel.loadedMissile).toMatchObject({ size: [12, 24], center: [6, 12], offsets: [10, 0], angles: [0] });
  });
  it('orders the original primary data and binds three editable records', () => {
    const snapshot = weaponJointFixture(),
      values = jointFixtureValues(snapshot),
      panel = projectWeaponPanel(snapshot, values);
    expect(panel.primary.map((stat) => stat.id)).toEqual([
      'role',
      'mount',
      'OPs',
      'range',
      'damage',
      'dps',
      'flux-second',
      'energy/shot',
      'flux-damage',
    ]);
    expect(panel.primary.find((stat) => stat.id === 'dps')!.display).toBe('500');
    expect(panel.primary.find((stat) => stat.id === 'flux-second')!.display).toBe('400');
    expect(panel.primary.find((stat) => stat.id === 'flux-damage')!.display).toBe('0.8');
    expect(panel.ancillary[0]!.fields[0]!).toMatchObject({ recordKey: 'csv', schema: { key: 'type' } });
    expect(panel.primary[1]!.fields.find((field) => field.schema.key === 'type')).toMatchObject({ recordKey: 'spec' });
    expect(panel.description.fields.map((field) => field.schema.key)).toEqual(['text1', 'text2', 'text3', 'text4', 'text5']);
    expect(panel.projectile!.fields[0]!.recordKey).toBe('spec');
    expect([panel.primarySettings.font, panel.ancillarySettings.font, panel.branch.font]).toEqual(['heading', 'heading', 'heading']);
  });
  it('uses original override text and edits the source parameters in the same popover', () => {
    const snapshot = weaponJointFixture();
    let values = jointFixtureValues(snapshot);
    const initial = projectWeaponPanel(snapshot, values);
    values = updateImmersiveField(values, snapshot.records[1]!, initial.ancillary.find((stat) => stat.id === 'accuracy')!.fields[0]!, {
      kind: 'set',
      value: 'Mod original accuracy',
    });
    const stat = projectWeaponPanel(snapshot, values).ancillary.find((stat) => stat.id === 'accuracy')!;
    expect(stat.display).toBe('Mod original accuracy');
    expect(stat.fields.map((field) => field.schema.key)).toContain('max spread');
    expect(snapshot.records[1]!.value).not.toEqual(values.csv);
    expect(jointObject(values.spec).unknown).toEqual({ retained: true });
  });
  it('keeps settings accessible when standard data and DPS are hidden', () => {
    const snapshot = weaponJointFixture(),
      values = jointFixtureValues(snapshot);
    values.csv = { state: 'present', value: { ...jointObject(values.csv), tags: 'no_standard_data', noDPSInTooltip: 'true' } };
    const panel = projectWeaponPanel(snapshot, values);
    expect(panel.primary.map((stat) => stat.id)).toEqual(['role', 'mount', 'OPs', 'energy/shot', 'flux-damage']);
    expect(panel.ancillary).toEqual([]);
    expect(panel.primarySettings.fields.map((field) => field.schema.key)).toContain('tags');
  });
  it('falls back to description role and uses literal highlight terms', () => {
    const snapshot = weaponJointFixture(),
      values = jointFixtureValues(snapshot);
    values.csv = { state: 'present', value: { ...jointObject(values.csv), primaryRoleStr: '' } };
    expect(projectWeaponPanel(snapshot, values).primary[0]!.display).toBe('Description role');
    expect(highlightedTextParts('<b>50%</b> damage', ' 50% |damage')).toEqual([
      { text: '<b>', highlight: false },
      { text: '50%', highlight: true },
      { text: '</b> ', highlight: false },
      { text: 'damage', highlight: true },
    ]);
  });
});
