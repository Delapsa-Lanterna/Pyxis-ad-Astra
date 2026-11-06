import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const sampleInfo = { id: 'desktop_sample', name: 'Desktop sample', version: '1', gameVersion: '0.98a' };
export const commodityText = (names = ['First', 'Second']) =>
  'id,name\n' + names.map((name, index) => 'sample_' + index + ',' + name).join('\n') + '\n';

/** @param {import('../shared/test-workspace.mjs').TestWorkspace} work @param {string | undefined} source @param {number} count */
export async function prepareSample(work, source, count) {
  const game = work.path('game'),
    mod = join(game, 'mods/sample'),
    core = join(game, 'starsector-core');
  await mkdir(join(core, 'graphics'), { recursive: true });
  if (source) await cp(source, mod, { recursive: true });
  else {
    for (const path of ['data/campaign', 'data/hulls', 'data/weapons']) await mkdir(join(mod, path), { recursive: true });
    await writeFile(join(mod, 'mod_info.json'), JSON.stringify(sampleInfo), 'utf8');
    await writeFile(join(mod, 'data/campaign/commodities.csv'), commodityText(), 'utf8');
    const columns = ['id', 'name', ...Array.from({ length: 38 }, (_, index) => 'sample_' + index)];
    for (const [path, kind] of /** @type {const} */ ([
      ['data/hulls/ship_data.csv', 'ship'],
      ['data/weapons/weapon_data.csv', 'weapon'],
    ])) {
      const rows = Array.from({ length: count }, (_, index) =>
        [kind + '_' + index, 'Sample ' + index, ...Array.from({ length: 38 }, (_, column) => String(index + column))].join(','),
      );
      await writeFile(join(mod, path), columns.join(',') + '\n' + rows.join('\n') + '\n', 'utf8');
    }
    await writeFile(join(mod, 'notes.txt'), 'Initial text', 'utf8');
  }
  await writeFile(
    join(core, 'graphics/first.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64'),
  );
  return {
    game,
    mod,
    core,
    descriptor: join(mod, 'mod_info.json'),
    table: join(mod, 'data/campaign/commodities.csv'),
    notes: join(mod, 'notes.txt'),
    source: source ?? 'generated',
    count,
  };
}
