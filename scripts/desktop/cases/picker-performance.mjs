import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareImmersiveSample } from '../sample.mjs';
import { openImmersiveWindow, until } from '../runtime.mjs';
import { createTestRun } from '../../shared/test-report.mjs';

/** @param {import('./registry.mjs').DesktopCase} context @param {'weapons'|'wings'|'hullmods'} kind */
export async function pickerPerformance({ launch, fixture, check, options, runs }, kind) {
  await prepareImmersiveSample(fixture, 0, kind, options.count);
  const app = await launch();
  const manifest = await app.main.evaluate(async (modRoot) => {
    const { document } = globalThis;
    const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke;
    const settings = await invoke('read_settings');
    await invoke('save_settings', {
      payload: { settings: { ...settings.value, immersiveGameFont: false, ignoreEditorWarnings: true, watchFileChanges: false } },
    });
    const manifest = await invoke('open_project_session', { payload: { modRoot, starsectorRoot: null } });
    Reflect.get(/** @type {HTMLElement} */ (document.querySelector('#app')), '__vue_app__')
      .config.globalProperties.$pinia._s.get('project')
      .registerProjectManifest(manifest);
    return manifest;
  }, fixture.mod);
  const root = { sessionId: manifest.sessionId, modRoot: manifest.modRoot, kind: /** @type {const} */ ('variant'), id: 'sample_variant' };
  const { editor, session, viewport, firstOpen } = await openImmersiveWindow(app, root);
  const list = editor.locator(kind === 'hullmods' ? '.variant-hullmod-list' : '.variant-picker-list');
  const run = createTestRun({
    scenario: kind,
    parameters: { entries: options.count },
    units: { entries: 'entries' },
    execution: 'native',
    completion: '候选绘制完成；选择后装配内容写盘并核对，窗口与目标释放',
    environment: { ...app.environment, ...viewport },
    warmup: options.warmup,
    rounds: options.rounds,
    samples: [],
    resources: { released: false, firstOpen },
  });
  runs.push(run);
  try {
    const query = { root, rowKey: null, values: null, newSources: [], catalog: kind };
    const catalog = await editor.evaluate(
      (payload) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('query_joint_edit', { payload }),
      query,
    );
    assert.equal(catalog.catalog.entries.length, options.count);
    for (let iteration = 0; iteration < options.warmup + options.rounds; iteration++)
      await check(kind + ':' + iteration, async () => {
        const metrics = /** @type {Record<string,number>} */ ({});
        const began = performance.now();
        if (kind === 'weapons') {
          await editor.getByRole('button', { name: '居中', exact: true }).click();
          await editor.locator('.variant-scene-canvas').click();
        } else if (kind === 'wings') await editor.locator('.variant-wing-tile').first().click();
        else await editor.locator('.variant-add-mod').click();
        await list.locator('[data-entry-id]').first().waitFor();
        await editor.evaluate(() => new Promise((done) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(done))));
        metrics.open = performance.now() - began;
        Object.assign(
          metrics,
          await list.evaluate(async (element) => {
            const frame = () => new Promise((done) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(done)));
            const first = element.querySelector('[data-entry-id]');
            const start = performance.now();
            for (const position of [0.5, 1, 0, 1, 0]) {
              element.scrollTop = (element.scrollHeight - element.clientHeight) * position;
              element.dispatchEvent(new Event('scroll'));
              await frame();
            }
            const roundTrip = performance.now() - start,
              traversal = performance.now();
            for (let top = 0; top < element.scrollHeight; top += element.clientHeight) {
              element.scrollTop = top;
              element.dispatchEvent(new Event('scroll'));
              await frame();
            }
            element.scrollTop = 0;
            element.dispatchEvent(new Event('scroll'));
            await frame();
            return {
              roundTrip,
              traverse: performance.now() - traversal,
              firstNodeRetained: Number(first === element.querySelector('[data-entry-id]')),
            };
          }),
        );
        const candidate = list.locator('[data-entry-id]').first();
        const id = await candidate.getAttribute('data-entry-id');
        assert.ok(id);
        const selected = performance.now();
        await candidate.click();
        if (kind === 'hullmods') await editor.locator('.variant-add-mod').click();
        const closed = performance.now();
        await list.waitFor({ state: 'hidden' });
        metrics.select = performance.now() - selected;
        metrics.close = performance.now() - closed;
        await editor.getByRole('button', { name: '保存', exact: true }).click();
        await editor.getByRole('status').filter({ hasText: '已保存' }).waitFor();
        const disk = JSON.parse(await readFile(join(fixture.mod, 'data/variants/sample.variant'), 'utf8'));
        if (kind === 'weapons')
          assert.ok(
            disk.weaponGroups.some((/** @type {{weapons:Record<string,string>}} */ group) => Object.values(group.weapons).includes(id)),
          );
        else assert.ok((kind === 'wings' ? disk.wings : disk.hullMods).includes(id));
        await editor.getByRole('button', { name: '清空装配', exact: true }).click();
        await editor.getByRole('dialog').getByRole('button', { name: '清空装配', exact: true }).click();
        await editor.getByRole('status').filter({ hasText: '未保存' }).waitFor();
        await editor.getByRole('button', { name: '保存', exact: true }).click();
        await editor.getByRole('status').filter({ hasText: '已保存' }).waitFor();
        run.samples.push({
          iteration,
          phase: iteration < options.warmup ? 'warmup' : 'measurement',
          metrics,
          assertions: [
            { name: '候选数量', pass: true, actual: catalog.catalog.entries.length, expected: options.count },
            { name: '选中装配写盘', pass: true, actual: id, expected: id },
          ],
        });
      });
  } finally {
    await session.detach();
  }
  await editor.locator('.immersive-actions').getByRole('button', { name: '关闭', exact: true }).click();
  await until(() => editor.isClosed(), 'picker host released');
  const owners = await app.main.evaluate(
    (targets) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('query_edit_target_owners', { targets }),
    [{ sessionId: root.sessionId, modRoot: root.modRoot, path: join(fixture.mod, 'data/variants/sample.variant') }],
  );
  assert.equal(owners.length, 0);
  run.resources.released = true;
  return {};
}
