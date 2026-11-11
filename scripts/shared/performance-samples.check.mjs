import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { csvSample, csvText, textSample, editedText, immersiveFiles } from './performance-samples.mjs';

test('text samples retain exact UTF-8 sizes and the requested line shape', () => {
  for (const bytes of [102400, 1048576, 10485760])
    for (const shape of /** @type {const} */ (['multiline', 'long-line'])) {
      const text = textSample(bytes, shape, 7);
      assert.equal(Buffer.byteLength(text), bytes);
      assert.ok(text.startsWith('007'));
      assert.ok(text.endsWith('\n'));
      assert.equal(text.split('\n').length > 2, shape === 'multiline');
      assert.equal(editedText(text, 3), '!!' + text + '!');
    }
});
test('CSV samples have forty columns and preserve comma-containing values', () => {
  for (const count of [50, 300, 2000]) {
    const { header, rows } = csvSample(count);
    assert.equal(header.length, 40);
    assert.equal(rows.length, count);
    assert.equal(rows.at(-1)?.id, 'ship_' + (count - 1));
    assert.ok(csvText(header, rows).includes('"sample,benchmark"'));
  }
});
test('immersive samples contain all five targets and the requested unrelated variants', () => {
  const defaults = JSON.parse(readFileSync(new URL('../../schemas/spec-defaults.json', import.meta.url), 'utf8'));
  const files = immersiveFiles(defaults, 50);
  assert.equal([...files.keys()].filter((path) => path.startsWith('data/variants/unrelated_')).length, 50);
  const variant = files.get('data/variants/sample.variant'),
    skin = files.get('data/hulls/skins/sample.skin');
  assert.ok(variant);
  assert.ok(skin);
  assert.equal(JSON.parse(variant).hullId, 'ship_0');
  assert.equal(JSON.parse(skin).baseHullId, 'ship_0');
  for (const kind of /** @type {const} */ (['weapons', 'wings', 'hullmods']))
    for (const count of [30, 100, 800]) {
      const sample = immersiveFiles(defaults, 0, kind, count);
      const path =
        kind === 'weapons' ? 'data/weapons/weapon_data.csv' : kind === 'wings' ? 'data/hulls/wing_data.csv' : 'data/hullmods/hull_mods.csv';
      const csv = sample.get(path);
      assert.ok(csv);
      assert.equal(csv.trim().split('\n').length - 1, count);
      if (kind === 'weapons') assert.equal([...sample.keys()].filter((path) => path.endsWith('.wpn')).length, count);
    }
});
test('Core immersive samples retain distinct identities and complete internal references', () => {
  const defaults = JSON.parse(readFileSync(new URL('../../schemas/spec-defaults.json', import.meta.url), 'utf8'));
  const local = immersiveFiles(defaults, 10),
    core = immersiveFiles(defaults, 1000, undefined, undefined, 'core_');
  assert.equal([...core.keys()].filter((path) => path.endsWith('.variant')).length, 1002);
  for (const [path, text] of core) {
    if (path.endsWith('.csv') || path === 'mod_info.json') continue;
    assert.equal(local.has(path), false);
    const value = JSON.parse(text);
    for (const field of ['id', 'hullId', 'baseHullId', 'skinHullId', 'variantId', 'projectileSpecId'])
      if (typeof value[field] === 'string') assert.ok(value[field].startsWith('core_'), field);
  }
  const wingTable = core.get('data/hulls/wing_data.csv');
  assert.ok(wingTable);
  assert.match(wingTable, /core_sample_wing,core_sample_fighter/);
});
