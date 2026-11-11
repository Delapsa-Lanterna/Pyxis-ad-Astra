export const samplePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=';
/** @param {number} bytes @param {'multiline'|'long-line'} shape @param {number} index */
export function textSample(bytes, shape, index) {
  const line = 'class Sample { int value = 1; }\n';
  return (
    String(index).padStart(3, '0') +
    (shape === 'long-line' ? 'x'.repeat(bytes - 4) : line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes - 4)) +
    '\n'
  );
}
/** @param {string} text @param {number} steps */
export function editedText(text, steps) {
  return '!'.repeat(Math.ceil(steps / 2)) + text + '!'.repeat(Math.floor(steps / 2));
}
/** @param {number} count @param {string} [kind] */
export function csvSample(count, kind = 'ship') {
  const header = ['id', 'name', 'mass', 'shield type', ...Array.from({ length: 36 }, (_, index) => 'sample_' + index)];
  const rows = Array.from({ length: count }, (_, index) =>
    Object.fromEntries(
      header.map((key) => [
        key,
        key === 'id'
          ? kind + '_' + index
          : key === 'name'
            ? 'Sample ' + kind + ' ' + index
            : key === 'mass'
              ? '100'
              : key === 'shield type'
                ? 'NONE'
                : key === 'sample_0'
                  ? 'sample,benchmark'
                  : String(index),
      ]),
    ),
  );
  return { header, rows };
}
/** @param {string[]} header @param {Record<string,string>[]} rows */
export function csvText(header, rows) {
  const cell = (/** @type {string} */ value) => (/[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value);
  return [header, ...rows.map((row) => header.map((key) => row[key] ?? ''))].map((row) => row.map(cell).join(',')).join('\n') + '\n';
}
/** @param {{ship:Record<string,unknown>,weapon:{projectile:Record<string,unknown>},projectile:{projectile:Record<string,unknown>}}} defaults @param {number} unrelatedVariants @param {'weapons'|'wings'|'hullmods'} [catalog] @param {number} [entries] @param {string} [prefix] */
export function immersiveFiles(defaults, unrelatedVariants, catalog, entries = 1, prefix = '') {
  const files = new Map([['mod_info.json', '{"id":"performance_sample","name":"Performance sample","version":"1","gameVersion":"0.98a"}']]);
  const json = (/** @type {string} */ path, /** @type {unknown} */ value) => files.set(path, JSON.stringify(value, null, 2) + '\n');
  const variant = (/** @type {string} */ id, /** @type {string} */ hullId) => ({
    variantId: prefix + id,
    hullId: prefix + hullId,
    displayName: id,
    goalVariant: false,
    fluxVents: 0,
    fluxCapacitors: 0,
    hullMods: [],
    permaMods: [],
    sMods: [],
    weaponGroups: [],
    wings: [],
  });
  for (const id of ['ship_0', 'ship_1'])
    json('data/hulls/' + prefix + id + '.ship', {
      ...defaults.ship,
      hullId: prefix + id,
      hullName: id,
      spriteName: 'graphics/sample.png',
      weaponSlots: [{ id: 'SLOT', type: 'BALLISTIC', size: 'SMALL', mount: 'TURRET', angle: 0, arc: 360, locations: [0, 0] }],
    });
  json('data/hulls/skins/' + prefix + 'sample.skin', {
    skinHullId: prefix + 'sample_skin',
    baseHullId: prefix + 'ship_0',
    hullName: 'Sample skin',
  });
  json('data/weapons/proj/' + prefix + 'sample_shot.proj', { ...defaults.projectile.projectile, id: prefix + 'sample_shot' });
  json('data/variants/' + prefix + 'sample.variant', variant('sample_variant', 'ship_0'));
  json('data/variants/' + prefix + 'fighter.variant', variant('sample_fighter', 'ship_0'));
  for (let index = 0; index < unrelatedVariants; index++)
    json('data/variants/' + prefix + 'unrelated_' + index + '.variant', variant('unrelated_' + index, 'ship_1'));
  files.set(
    'data/hulls/ship_data.csv',
    'id,name,hitpoints,armor rating,max flux,flux dissipation,ordnance points,max speed,shield type,min crew,max crew,mass,fighter bays\n' +
      prefix +
      'ship_0,Sample ship,1000,100,1000,100,50,100,NONE,1,2,100,1\n' +
      prefix +
      'ship_1,Other ship,1000,100,1000,100,50,100,NONE,1,2,100,1\n',
  );
  const weapons = [],
    wings = [],
    hullmods = [];
  for (let index = 0; index < (catalog ? entries : 1); index++) {
    const weaponId = prefix + 'weapon_' + index;
    if (catalog === 'weapons' || index === 0) {
      json('data/weapons/' + weaponId + '.wpn', {
        ...defaults.weapon.projectile,
        id: weaponId,
        turretSprite: 'graphics/sample.png',
        hardpointSprite: 'graphics/sample.png',
        projectileSpecId: prefix + 'sample_shot',
      });
      weapons.push({
        id: weaponId,
        name: 'Weapon ' + index,
        type: 'ENERGY',
        range: '500',
        'damage/shot': '100',
        'energy/shot': '10',
        OPs: '1',
        chargedown: '1',
      });
    }
    if (catalog === 'wings' || index === 0)
      wings.push({
        id: prefix + (index === 0 ? 'sample_wing' : 'wing_' + index),
        variant: prefix + 'sample_fighter',
        num: '1',
        role: 'FIGHTER',
        'role desc': 'Sample role',
        formation: 'V',
        'op cost': '1',
        refit: '10',
        range: '1000',
      });
    if (catalog === 'hullmods' || index === 0)
      hullmods.push({
        id: prefix + 'hullmod_' + index,
        name: 'Hullmod ' + index,
        tier: '1',
        rarity: '1',
        cost_frigate: '1',
        cost_destroyer: '1',
        cost_cruiser: '1',
        cost_capital: '1',
        sprite: 'graphics/sample.png',
        uiTags: 'Weapons',
        desc: 'Sample hullmod',
      });
  }
  files.set('data/weapons/weapon_data.csv', csvText(Object.keys(/** @type {Record<string,string>} */ (weapons[0])), weapons));
  files.set('data/hulls/wing_data.csv', csvText(Object.keys(/** @type {Record<string,string>} */ (wings[0])), wings));
  files.set('data/hullmods/hull_mods.csv', csvText(Object.keys(/** @type {Record<string,string>} */ (hullmods[0])), hullmods));
  files.set('data/strings/descriptions.csv', 'id,type,text1,text2,text3,text4\n');
  return files;
}
