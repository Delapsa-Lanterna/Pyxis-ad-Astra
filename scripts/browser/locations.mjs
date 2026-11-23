import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { runBrowser } from './runtime.mjs';
import { demoBase } from './build.mjs';
import { serve } from './serve.mjs';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:1461/' },
    output: { type: 'string' },
    production: { type: 'boolean' },
    section: { type: 'string', default: 'all' },
  },
});
const server = values.production
  ? await serve({ production: true, directory: 'node_modules/.cache/browser/demo-builds', base: demoBase, demo: true })
  : null;
const url = server ? server.url + demoBase : values.url;
const base = new URL(url.endsWith('/') ? url : url + '/');
await runBrowser('preview', values, async ({ newPage, artifacts }) => {
  const { page } = await newPage(base.href);
  const checks = /** @type {import('../shared/test-report.mjs').TestCheck[]} */ ([]);
  const errors = /** @type {string[]} */ ([]);
  /** @param {string} name @param {() => Promise<void>} work */
  async function check(name, work) {
    try {
      await work();
      checks.push({ name, pass: true });
      console.log(name);
    } catch (error) {
      checks.push({ name, pass: false });
      errors.push(name + ': ' + (error instanceof Error ? (error.stack ?? error.message) : String(error)));
      console.log('FAILED: ' + name);
      await page.screenshot({ path: artifacts + '/failure-' + checks.length + '.png' });
    }
  }
  /** @param {Record<string, string>} parameters */
  async function open(parameters) {
    const target = new URL(base);
    target.search = new URLSearchParams(parameters).toString();
    await page.goto(target.href);
    await page.waitForFunction(
      () => globalThis.document.body.dataset.locationReady === 'true' || globalThis.document.querySelector('#browser-location-error'),
    );
    assert.equal(
      await page.locator('#browser-location-error').count(),
      0,
      (await page.locator('#browser-location-error').allTextContents()).join('\n'),
    );
  }
  await page.waitForFunction(() => globalThis.document.body.dataset.locationReady === 'true');
  for (const view of ['settings', 'about', 'workspace'])
    await check('global ' + view, async () => {
      await open({ view });
      if (view === 'workspace')
        await page.frameLocator('iframe[data-window="main"]').getByRole('button', { name: '进入编辑' }).first().waitFor();
      else
        await page
          .frameLocator('iframe[data-window="main"]')
          .getByRole('heading', { name: view === 'settings' ? '设置' : '关于', exact: true })
          .waitFor();
    });
  const tablePages = await page.evaluate(() => {
    const entries = /** @type {{id: string}[]} */ (Reflect.get(globalThis, 'browserWorkspaceEntries'));
    return entries.filter(({ id }) => id.startsWith('navigation-table:')).map(({ id }) => id.slice('navigation-table:'.length));
  });
  const inventory = await page.evaluate(() => {
    const workspace = Reflect.get(globalThis, 'browserWorkspace');
    return workspace.projects.map(
      (
        /** @type {{manifest:{modInfo:{id:string},modRoot:string},tables:Map<string,{header:string[],rows:{rowKey:string,data:Record<string,string>}[]}>,entities:Map<string,{kind:string,id:string,target:{write:{relPath:string}}}>}} */ project,
      ) => ({
        id: String(project.manifest.modInfo.id),
        root: project.manifest.modRoot,
        tables: [...project.tables].map(([table, data]) => ({
          table,
          rows: data.rows.map((row) => ({ key: row.rowKey, data: row.data })),
          header: data.header,
        })),
        entities: [...project.entities.values()].map((entity) => ({ kind: entity.kind, id: entity.id, path: entity.target.write.relPath })),
      }),
    );
  });
  const main = page.frameLocator('iframe[data-window="main"]');
  if (values.section === 'all')
    for (const project of inventory) {
      await check(project.id + ' misc file corvusSpawnpoints', async () => {
        await open({ view: 'json', mod: project.id, page: 'misc-config', id: 'corvusSpawnpoints' });
        await main.locator('[data-entity-id="corvusSpawnpoints"].active').waitFor();
      });
      for (const target of [
        { view: 'mod-overview' },
        { view: 'file-history' },
        { view: 'files' },
        ...tablePages.map((table) => ({ view: 'table', table })),
        ...['mod-info', 'factions', 'mission', 'variants', 'skins', 'misc-config']
          .filter((entry) => entry !== 'mod-info' || project.id !== 'starsector-core')
          .map((entry) => ({ view: 'json', page: entry })),
        { view: 'code' },
      ]) {
        await check(project.id + ' ' + JSON.stringify(target), async () => {
          await open({ mod: project.id, ...target });
          if (target.view === 'code') await page.frameLocator('iframe[data-window^="window-"]').locator('.code-editor').waitFor();
          else {
            const state = await page.locator('iframe[data-window="main"]').evaluate((frame) => {
              const document = /** @type {HTMLIFrameElement} */ (frame).contentDocument;
              return document?.querySelector('.page-title, .json-entity-list-header-title, [role=grid], .file-browser-page') !== null;
            });
            assert.equal(state, true);
          }
        });
      }
    }
  const polaris = inventory.find((/** @type {{id:string}} */ project) => project.id === 'Polaris_Prime');
  assert.ok(polaris);
  await check('CSV ID, row and last column', async () => {
    const table = polaris.tables.find((/** @type {{table:string}} */ entry) => entry.table === 'ships');
    const row = table.rows.find((/** @type {{data:Record<string,string>}} */ entry) => entry.data.id === 'PLSP_blazar');
    const column = table.header.at(-1);
    assert.ok(column);
    await open({ view: 'table', mod: polaris.id, table: 'ships', id: 'PLSP_blazar', column });
    await main.locator('[data-row-key="' + row.key + '"] [data-column-key="' + column + '"]').waitFor();
    assert.equal(await main.locator('.csv-grid-record.selected').getAttribute('data-row-key'), row.key);
    await page.reload();
    await page.waitForFunction(() => globalThis.document.body.dataset.locationReady === 'true');
    assert.equal(await main.locator('.csv-grid-record.selected').getAttribute('data-row-key'), row.key);
  });
  for (const [kind, destination] of /** @type {[string,string][]} */ ([
    ['skin', 'skins'],
    ['variant', 'variants'],
    ['faction', 'factions'],
    ['mission', 'mission'],
  ])) {
    const entity = polaris.entities.find((/** @type {{kind:string}} */ entry) => entry.kind === kind);
    await check('JSON selection ' + kind, async () => {
      await open({ view: 'json', mod: polaris.id, page: destination, id: entity.id });
      await main.locator('[data-entity-id="' + entity.id + '"].active').waitFor();
    });
  }
  for (const id of ['strings', 'engineStyles', 'hullStyles', 'sounds', 'settings'])
    await check('misc file ' + id, async () => {
      await open({ view: 'json', mod: polaris.id, page: 'misc-config', id });
      await main.locator('[data-entity-id="' + id + '"].active').waitFor();
    });
  for (const kind of ['ship', 'weapon', 'projectile', 'system'])
    await check('spec ' + kind, async () => {
      const entity = polaris.entities.find((/** @type {{kind:string}} */ entry) => entry.kind === kind);
      await open({ view: 'spec', mod: polaris.id, kind, id: entity.id });
      await page
        .frameLocator('iframe[data-window^="window-"]')
        .locator('.editor-spec-page .editor-window, .editor-spec-page .projectile-window')
        .waitFor();
    });
  for (const kind of ['ship', 'skin', 'weapon', 'wing', 'variant'])
    await check('immersive ' + kind, async () => {
      const id =
        kind === 'wing'
          ? polaris.tables.find((/** @type {{table:string}} */ entry) => entry.table === 'wings').rows[0].data.id
          : kind === 'ship'
            ? 'PLSP_blazar'
            : polaris.entities.find((/** @type {{kind:string}} */ entry) => entry.kind === kind).id;
      await open({ view: 'immersive', mod: polaris.id, kind, id });
      await page.frameLocator('iframe[data-window^="window-"]').locator('.immersive-editor-shell').waitFor();
      const panel = kind === 'ship' || kind === 'skin' ? '.ship-immersive-header' : '.' + kind + '-immersive-panel';
      await page.frameLocator('iframe[data-window^="window-"]').locator(panel).waitFor();
      if (kind === 'ship') {
        await page.frameLocator('iframe[data-window^="window-"]').getByRole('button', { name: '耀变体(Blazar)', exact: true }).waitFor();
        await page.screenshot({ path: artifacts + '/blazar.png', fullPage: true });
        await page.reload();
        await page.waitForFunction(() => globalThis.document.body.dataset.locationReady === 'true');
        await page.frameLocator('iframe[data-window^="window-"]').getByRole('button', { name: '耀变体(Blazar)', exact: true }).waitFor();
      }
    });
  await check('weapon preview', async () => {
    const entity = polaris.entities.find((/** @type {{kind:string}} */ entry) => entry.kind === 'weapon');
    await open({ view: 'preview', mod: polaris.id, id: entity.id });
    await page.frameLocator('iframe[data-window^="window-"]').locator('.preview-window').waitFor();
  });
  for (const view of ['text', 'code'])
    await check(view + ' file, line and column', async () => {
      await open({ view, mod: polaris.id, path: 'mod_info.json', line: '3', column: '4' });
      const editor = page.frameLocator('iframe[data-window^="window-"]');
      await editor.locator('.cm-content').waitFor();
      assert.match(await editor.locator('.cm-content').innerText(), /Polaris_Prime/);
      await page.waitForFunction(() => {
        const frame = globalThis.document.querySelector('iframe[data-window^="window-"]');
        const document = /** @type {HTMLIFrameElement} */ (frame).contentDocument;
        if (!document) return false;
        const selection = document.getSelection();
        if (!selection?.anchorNode) return false;
        const line = selection?.anchorNode?.parentElement?.closest('.cm-line');
        if (!line) return false;
        const range = document.createRange();
        range.selectNodeContents(line);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        return [...document.querySelectorAll('.cm-line')].indexOf(line) === 2 && range.toString().length === 3;
      });
      await editor.locator('.cm-content').press('ArrowDown');
      await page.waitForURL(/line=4/);
      await page.goBack();
      await page.waitForFunction(() => globalThis.document.body.dataset.locationReady === 'true');
      assert.equal(new URL(page.url()).searchParams.get('line'), '3');
    });
  await check('file browser selected path', async () => {
    await open({ view: 'files', mod: polaris.id, path: 'data/hulls/ship_data.csv' });
    await main.locator('[title="data/hulls/ship_data.csv"]').waitFor();
  });
  await check('sample code window refresh', async () => {
    await page.goto(new URL('?sampleWindow=code-window', base).href);
    await page.waitForFunction(() => globalThis.document.body.dataset.locationReady === 'true');
    await page.frameLocator('iframe[data-window^="window-"]').locator('.code-editor-tabs .mod-tab').nth(2).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('sampleWindow'), 'code-window');
    await page.reload();
    await page.waitForFunction(() => globalThis.document.body.dataset.locationReady === 'true');
    await page.frameLocator('iframe[data-window^="window-"]').locator('.code-editor-tabs .mod-tab').nth(2).waitFor();
  });
  await check('history synchronization', async () => {
    await open({ view: 'mod-overview', mod: polaris.id });
    await main.getByRole('button', { name: '工作区菜单', exact: true }).click();
    await main.getByRole('button', { name: '关于', exact: true }).click();
    await page.waitForURL(/view=about/);
    await page.goBack();
    await main.getByRole('heading', { name: '北极星之首 [Polaris Prime]', exact: true }).waitFor();
    await page.goForward();
    await main.getByRole('heading', { name: '关于', exact: true }).waitFor();
  });
  const sceneSamples = /** @type {[string,string][]} */ ([
    ['csv', 'csv'],
    ['immersive', 'ship'],
    ['immersive', 'skin'],
    ['immersive', 'weapon'],
    ['immersive', 'wing'],
    ['immersive', 'variant'],
    ['fields', 'fields'],
    ['pickers', 'weapons'],
    ['pickers', 'wings'],
    ['pickers', 'hullmods'],
    ['resources', 'resources'],
    ['feedback', 'feedback'],
  ]);
  for (const [scene, sample] of sceneSamples)
    await check('scene ' + scene + ' ' + sample, async () => {
      const target = new URL(base);
      target.search = new URLSearchParams({ view: 'scene', scene, sample }).toString();
      await page.goto(target.href);
      await page.locator('#status[data-ready="true"]').waitFor();
      assert.equal(await page.locator('#sample').inputValue(), sample);
    });
  for (const scene of [
    'csv',
    'weapons',
    'wings',
    'hullmods',
    'code-editor',
    'text-editor',
    'ship',
    'skin',
    'weapon',
    'wing',
    'variant',
    'java-queries',
  ]) {
    await check('testbed ' + scene, async () => {
      const target = new URL('testbed/', base);
      target.search = new URLSearchParams({ view: 'testbed', scene, count: '3', warmup: '0', rounds: '1' }).toString();
      await page.goto(target.href);
      await page.waitForFunction(() => globalThis.document.body.dataset.locationReady === 'true');
      assert.equal(await page.locator('#scene').inputValue(), scene);
      assert.equal(await page.locator('#count').inputValue(), '3');
    });
  }
  await check('testbed root link', async () => {
    await page.goto(new URL('?view=testbed&scene=ship&count=3', base).href);
    await page.waitForURL(/\/testbed\//);
    await page.waitForFunction(() => globalThis.document.body.dataset.locationReady === 'true');
    assert.equal(await page.locator('#scene').inputValue(), 'ship');
  });
  await check('invalid link feedback', async () => {
    await page.goto(new URL('?view=immersive&mod=missing&kind=ship&id=missing', base).href);
    await page.locator('#browser-location-error').waitFor();
    assert.match(await page.locator('#browser-location-error').innerText(), /项目不存在/);
  });
  return { checks, runs: [], errors };
}).finally(() => server?.close());
