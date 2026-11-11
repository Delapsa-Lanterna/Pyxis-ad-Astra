import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { csvSample, csvText, immersiveFiles, samplePng } from '../shared/performance-samples.mjs';

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
    for (const [path, kind] of /** @type {const} */ ([
      ['data/hulls/ship_data.csv', 'ship'],
      ['data/weapons/weapon_data.csv', 'weapon'],
    ])) {
      const { header, rows } = csvSample(count, kind);
      await writeFile(join(mod, path), csvText(header, rows), 'utf8');
    }
    await writeFile(join(mod, 'notes.txt'), 'Initial text', 'utf8');
  }
  await writeFile(join(core, 'graphics/first.png'), Buffer.from(samplePng, 'base64'));
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

/** @param {Awaited<ReturnType<typeof prepareSample>>} fixture @param {number} count @param {'weapons'|'wings'|'hullmods'} [catalog] @param {number} [entries] @param {string} [prefix] */
export async function prepareImmersiveSample(fixture, count, catalog, entries, prefix = '') {
  const defaults = JSON.parse(await readFile(new URL('../../schemas/spec-defaults.json', import.meta.url), 'utf8'));
  for (const [relative, content] of immersiveFiles(defaults, count, catalog, entries, prefix)) {
    const path = join(fixture.mod, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
  await mkdir(join(fixture.mod, 'graphics'), { recursive: true });
  await writeFile(join(fixture.mod, 'graphics/sample.png'), Buffer.from(samplePng, 'base64'));
}
