import { appThemes } from '../../shared/app-themes.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { stores, invoke as api } from '../config.mjs';
import { openMod, waitFor, until } from '../runtime.mjs';
import { commodityText, sampleInfo } from '../sample.mjs';

/** @param {Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>} app @param {Awaited<ReturnType<typeof import('../sample.mjs').prepareSample>>} fixture @param {(name:string,operation:()=>Promise<void>)=>Promise<void>} check @param {string} artifacts */
export async function sourceSync(app, fixture, check, artifacts) {
  const { main: active, context } = app;
  const { game, mod, core, table, descriptor, notes } = fixture;
  await mkdir(join(core, 'data/hulls'), { recursive: true });
  await writeFile(join(core, 'data/hulls/wing_data.csv'), 'id,variant,role desc,formation,num,role,refit,tags\n', 'utf8');
  await active.evaluate(stores + '.get("settings").setWatchFileChanges(true)');
  await waitFor(active, '(async()=> (await ' + api + '("read_settings")).value.watchFileChanges)()');
  await mkdir(join(mod, 'graphics'), { recursive: true });
  await writeFile(join(mod, 'graphics/memory.png'), await readFile(join(core, 'graphics/first.png')));
  await writeFile(
    join(mod, 'data/hulls/ship_0.ship'),
    JSON.stringify({
      hullId: 'ship_0',
      hullName: 'Memory sample',
      hullSize: 'FRIGATE',
      style: 'LOW_TECH',
      spriteName: 'graphics/memory.png',
      width: 1,
      height: 1,
      center: [0, 0],
      bounds: [],
      collisionRadius: 1,
      shieldCenter: [0, 0],
      shieldRadius: 1,
      weaponSlots: [],
      engineSlots: [],
    }),
    'utf8',
  );
  const state = stores + '.get("csv-editor").getCsvModState(window.__desktopTarget.modRoot).documents.commodities';
  await check('Core window with zero Mod sessions', async () => {
    await active.evaluate(
      stores +
        '.get("workspace").setGameOverview(' +
        JSON.stringify({ starsectorRoot: game, coreAvailable: true, modsDir: join(game, 'mods'), mods: [], warnings: [] }) +
        ')',
    );
    await waitFor(active, stores + '.get("core-assets").root !== null');
    await active.evaluate(api + '("scan_core_graphics",{payload:{starsectorRoot:' + JSON.stringify(game) + '}})');
    await writeFile(join(core, 'graphics/second.png'), await readFile(join(core, 'graphics/first.png')));
    await waitFor(active, stores + '.get("core-assets").graphics.content.includes("graphics/second.png")');
  });
  const manifest = await openMod(active, mod, game, 'commodities');
  await active.evaluate(stores + '.get("settings").setEditMode("plain");' + stores + '.get("settings").setLogLevel("debug")');
  await waitFor(active, state + '.rowOrder.length===2');
  await check('Core rescan reads the current bytes and repairs a failed source', async () => {
    const directory = join(core, 'data/weapons/proj');
    const file = join(directory, 'desktop_sample.proj');
    const query = api + '("query_entity",{payload:{sessionId:window.__desktopTarget.sessionId,kind:"projectile",id:"desktop_sample"}})';
    await mkdir(directory, { recursive: true });
    for (const damage of [1, 2, 3]) {
      await writeFile(file, JSON.stringify({ id: 'desktop_sample', damage }), 'utf8');
      if (damage === 3) await active.evaluate(api + '("retry_source_watch",{root:' + JSON.stringify(core) + '})');
      await waitFor(active, '(async()=>{const entity=await ' + query + ';return entity?.data.damage===' + damage + '})()');
    }
    await writeFile(file, '{', 'utf8');
    await waitFor(active, stores + '.get("project-sync").sourceIssues.some(issue=>issue.source==="core")');
    await writeFile(file, JSON.stringify({ id: 'desktop_sample', damage: 4 }), 'utf8');
    await active.evaluate(api + '("retry_source_watch",{root:' + JSON.stringify(core) + '})');
    await waitFor(active, '(async()=>{const entity=await ' + query + ';return entity?.data.damage===4})()');
    await waitFor(active, stores + '.get("project-sync").sourceIssues.length===0');
  });
  await check('Continuous external writes update a clean table', async () => {
    for (let index = 0; index < 20; index++) await writeFile(table, commodityText(['External ' + index, 'Second']), 'utf8');
    await waitFor(active, 'Object.values(' + state + '.rows).some(row=>row.data.name==="External 19")');
  });
  await check('Atomic file replacement', async () => {
    await writeFile(table + '.tmp', commodityText(['Atomic', 'Second']), 'utf8');
    await rename(table + '.tmp', table);
    await waitFor(active, 'Object.values(' + state + '.rows).some(row=>row.data.name==="Atomic")');
  });
  const rowKey = await active.evaluate(state + '.rowOrder[0]');
  await check('Uncommitted CSV input survives external content', async () => {
    const cell = active.locator('[data-row-key="' + rowKey + '"] [data-column-key="name"] .csv-cell-frame');
    await cell.dblclick();
    const input = active.locator('.csv-cell-text-input');
    await input.fill('Raw local input');
    await writeFile(table, commodityText(['External raw', 'Second']), 'utf8');
    await waitFor(active, state + '.externalUpdatePending');
    assert.equal(await input.inputValue(), 'Raw local input');
    await input.press('Escape');
    await active.evaluate(
      stores +
        '.get("csv-editor").discardTableDraftForReload({sessionId:window.__desktopTarget.sessionId,modRoot:window.__desktopTarget.modRoot,table:"commodities"})',
    );
    await writeFile(table, commodityText(['Rebased', 'Second']), 'utf8');
    await waitFor(active, state + '.rowOrder.length===2 && !' + state + '.externalUpdatePending');
  });
  await check('CSV row-order draft stages an externally added row', async () => {
    await active.evaluate(
      'const tables=' +
        stores +
        '.get("csv-editor");tables.moveRows({sessionId:window.__desktopTarget.sessionId,modRoot:window.__desktopTarget.modRoot,table:"commodities"},[' +
        state +
        '.rowOrder[1]],0)',
    );
    const before = await active.evaluate(
      'JSON.stringify({order:' + state + '.rowOrder,base:' + state + '.baseVersions,history:' + state + '.history})',
    );
    await writeFile(table, commodityText(['Rebased', 'Second', 'Added externally']), 'utf8');
    await waitFor(active, state + '.externalUpdatePending');
    assert.equal(
      await active.evaluate('JSON.stringify({order:' + state + '.rowOrder,base:' + state + '.baseVersions,history:' + state + '.history})'),
      before,
    );
    assert.equal(await active.evaluate('Object.values(' + state + '.dirty).some(row=>row.action==="delete")'), false);
  });
  await check('Source parse failure and repair retain the CSV draft', async () => {
    await writeFile(descriptor, '{', 'utf8');
    await waitFor(active, stores + '.get("project-sync").sourceIssues.length===1');
    assert.equal(await active.evaluate(state + '.externalUpdatePending'), true);
    await writeFile(descriptor, JSON.stringify({ ...sampleInfo, name: 'Repaired source' }), 'utf8');
    await waitFor(active, stores + '.get("project-sync").sourceIssues.length===0');
  });
  await active.evaluate(
    api +
      '("request_window",{payload:{identity:{type:"text-editor",sessionId:window.__desktopTarget.sessionId,modRoot:window.__desktopTarget.modRoot,path:' +
      JSON.stringify(notes) +
      '},title:"Source test text",input:{kind:"text-editor",location:{contextLabel:null,contextSeverity:null,message:null,line:null,column:null}},width:1040,height:760,minWidth:780,minHeight:520}})',
  );
  let textPage;
  for (let attempt = 0; attempt < 100; attempt++) {
    textPage = context.pages().find((page) => page !== active && page.url().startsWith('http://tauri.localhost'));
    if (textPage) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(textPage, 'Text editor window is available');
  await textPage.getByRole('textbox', { name: '文件内容' }).waitFor();
  await check('Native foreground and background transitions retain the live text editor', async () => {
    await active.evaluate(api + '("plugin:window|set_focus",{label:"main"})');
    await textPage.getByRole('textbox', { name: '文件内容' }).fill('Memory policy input');
    const identity = { type: 'text-editor', sessionId: manifest.sessionId, modRoot: manifest.modRoot, path: notes };
    await active.evaluate(api + '("focus_managed_window",{identity:' + JSON.stringify(identity) + '})');
    await textPage.getByRole('textbox', { name: '文件内容' }).press('End');
    await textPage.getByRole('textbox', { name: '文件内容' }).press('!');
    assert.equal(await textPage.getByRole('textbox', { name: '文件内容' }).innerText(), 'Memory policy input!');
    await textPage.getByRole('button', { name: '保存', exact: true }).click();
    await until(async () => (await readFile(notes, 'utf8')) === 'Memory policy input!', 'text save after native focus transition');
    await textPage.getByRole('textbox', { name: '文件内容' }).fill('Initial text');
    await textPage.getByRole('button', { name: '保存', exact: true }).click();
    await until(async () => (await readFile(notes, 'utf8')) === 'Initial text', 'text baseline restoration');
  });
  await check('Managed window focus reuses the isolated text window', async () => {
    const identity = { type: 'text-editor', sessionId: manifest.sessionId, modRoot: manifest.modRoot, path: notes };
    assert.equal(await active.evaluate(api + '("focus_managed_window",{identity:' + JSON.stringify(identity) + '})'), true);
    assert.equal(context.pages().length, 2);
  });
  await check('Text window follows a reliable native rename and retains its draft', async () => {
    await textPage.getByRole('textbox', { name: '文件内容' }).fill('Local text draft');
    await writeFile(notes, 'External text', 'utf8');
    await textPage.getByText('外部文本已更新，当前未保存草稿已保留。', { exact: true }).waitFor();
    assert.equal(await textPage.getByRole('textbox', { name: '文件内容' }).innerText(), 'Local text draft');
    await rename(notes, join(mod, 'renamed.txt'));
    await textPage.getByRole('button', { name: '保留文本并跟随', exact: true }).click();
    await until(
      async () => (await textPage.locator('.text-editor-path').getAttribute('title'))?.endsWith('renamed.txt'),
      'native rename target handoff',
    );
    assert.equal(await textPage.getByRole('textbox', { name: '文件内容' }).innerText(), 'Local text draft');
  });
  for (const theme of appThemes)
    for (const width of [1280, 900]) {
      await active.evaluate(stores + '.get("settings").setTheme(' + JSON.stringify(theme) + ')');
      await active.setViewportSize({ width, height: 800 });
      await active.emulateMedia({ reducedMotion: 'reduce' });
      await active.screenshot({ path: join(artifacts, 'source-' + theme + '-' + width + '.png') });
    }
  await check('Deleting and rebuilding a loaded CSV preserves recovery content', async () => {
    await unlink(table);
    await waitFor(
      active,
      stores + '.get("project").getManifest(window.__desktopTarget.modRoot).tableSummaries.commodities.available===false',
    );
    assert.equal(await active.evaluate(state + '.rowOrder.length'), 2);
    await writeFile(table, commodityText(['Rebuilt', 'Second']), 'utf8');
    await waitFor(active, stores + '.get("project").getManifest(window.__desktopTarget.modRoot).tableSummaries.commodities.available');
  });
  await check('Native memory policy preserves a real canvas across focus and normal close', async () => {
    const identity = { type: 'spec', kind: 'ship', sessionId: manifest.sessionId, modRoot: manifest.modRoot, id: 'ship_0' };
    await active.evaluate(
      api +
        '("request_window",{payload:' +
        JSON.stringify({
          identity,
          title: 'Memory canvas',
          input: { kind: 'editor', starsectorRoot: game },
          width: 1100,
          height: 800,
          minWidth: 780,
          minHeight: 520,
        }) +
        '})',
    );
    const canvasPage = context.pages().find((page) => page !== active && page !== textPage);
    assert.ok(canvasPage);
    const canvas = canvasPage.locator('canvas.editor-canvas');
    await canvas.waitFor();
    await active.evaluate(api + '("plugin:window|set_focus",{label:"main"})');
    assert.equal(await active.evaluate(api + '("focus_managed_window",{identity:' + JSON.stringify(identity) + '})'), true);
    await canvas.hover();
    await canvasPage.mouse.wheel(0, 100);
    assert.equal(
      await canvas.evaluate((node) => {
        const surface = /** @type {HTMLCanvasElement} */ (node);
        return surface.width > 0 && surface.height > 0;
      }),
      true,
    );
    await canvas.screenshot({ path: join(artifacts, 'source-canvas.png') });
    await canvasPage.locator('.titlebar-button.close').click();
    await until(() => canvasPage.isClosed(), 'canvas window normal close');
  });
  const validationMod = join(game, 'mods/validation');
  for (const directory of ['data/hulls', 'data/variants', 'data/campaign', 'src/probe'])
    await mkdir(join(validationMod, directory), { recursive: true });
  for (const directory of ['data/hulls', 'data/variants']) await mkdir(join(core, directory), { recursive: true });
  await writeFile(join(validationMod, 'mod_info.json'), JSON.stringify({ ...sampleInfo, id: 'validation' }), 'utf8');
  const defaults = JSON.parse(await readFile(join(mod, 'data/hulls/ship_0.ship'), 'utf8'));
  await Promise.all(
    Array.from({ length: 200 }, (_, index) =>
      writeFile(
        join(core, 'data/hulls/probe_' + index + '.ship'),
        JSON.stringify({
          ...defaults,
          hullId: 'probe_' + index,
          hullName: 'Probe',
          hullSize: 'FIGHTER',
          spriteName: 'graphics/first.png',
          width: 1,
          height: 1,
        }),
        'utf8',
      ),
    ),
  );
  await Promise.all(
    Array.from({ length: 31 }, (_, index) =>
      writeFile(
        join(core, 'data/variants/probe_' + index + '.variant'),
        JSON.stringify({
          variantId: 'probe_' + index,
          hullId: 'probe_' + index,
          displayName: 'Probe',
          weaponGroups: [],
          hullMods: [],
          wings: [],
          fluxVents: 0,
          fluxCapacitors: 0,
        }),
        'utf8',
      ),
    ),
  );
  await writeFile(
    join(core, 'data/hulls/ship_data.csv'),
    'id,name,mass,shield type\n' + Array.from({ length: 200 }, (_, index) => 'probe_' + index + ',Probe,1,NONE').join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    join(core, 'data/hulls/wing_data.csv'),
    'id,variant,role desc,formation,num,role,refit,tags\n' +
      Array.from({ length: 31 }, (_, index) => 'probe_' + index + '_wing,probe_' + index + ',Probe,V,1,FIGHTER,10,').join('\n') +
      '\n',
    'utf8',
  );
  await writeFile(
    join(validationMod, 'data/hulls/wing_data.csv'),
    'id,variant,role desc,formation,num,role,refit,tags\nprobe_0_wing,probe_0,Probe,V,1,FIGHTER,10,\n',
    'utf8',
  );
  await writeFile(
    join(validationMod, 'data/campaign/market_conditions.csv'),
    'name,id,script,icon\nProbe,probe,probe.Script,graphics/first.png\n',
    'utf8',
  );
  const validation = await openMod(active, validationMod, game, 'wings');
  await check('Complete Core hull and wing sources validate and save through the immersive editor', async () => {
    const request = {
      sessionId: validation.sessionId,
      entities: [
        ...Array.from({ length: 200 }, (_, index) => ({ kind: 'ship', id: 'probe_' + index })),
        ...Array.from({ length: 31 }, (_, index) => ({ kind: 'variant', id: 'probe_' + index })),
      ],
      sources: [],
      files: [],
      classes: [],
      stationData: [],
    };
    await waitFor(
      active,
      '(async()=>Object.keys((await ' +
        api +
        '("query_csv_validation",{payload:' +
        JSON.stringify(request) +
        '})).entities).length===231)()',
    );
    const document = stores + '.get("csv-editor").getCsvModState(window.__desktopTarget.modRoot).documents.wings';
    await waitFor(active, document + '.rowOrder.length===1');
    const rowKey = await active.evaluate(document + '.rowOrder[0]');
    await active.evaluate(
      api +
        '("request_window",{payload:' +
        JSON.stringify({
          identity: { type: 'immersive', kind: 'wing', sessionId: validation.sessionId, modRoot: validation.modRoot, id: 'probe_0_wing' },
          title: 'Validation wing',
          input: { kind: 'immersive-editor', rowKey },
          width: 600,
          height: 900,
          minWidth: 340,
          minHeight: 480,
        }) +
        '})',
    );
    await until(() => context.pages().some((page) => ![active, textPage].includes(page)), 'validation wing window');
    const page = context.pages().find((page) => ![active, textPage].includes(page));
    assert.ok(page);
    await page.locator('.wing-immersive-panel').waitFor();
    await until(
      () =>
        page
          .locator('.editor-problem.error:visible')
          .count()
          .then((count) => count === 0),
      'zero Core source errors',
    );
    await page.screenshot({ path: join(artifacts, 'validation-wing-core.png') });
    await page
      .locator('.immersive-source-notice-content')
      .filter({ hasText: 'ship_data.csv' })
      .getByRole('button', { name: '建立此来源的 Mod 覆盖', exact: true })
      .click();
    await until(async () => {
      const confirm = page.locator('[role="dialog"]').getByRole('button', { name: /^(保存|创建本地覆盖|仍然保存)$/ });
      await confirm.evaluateAll((buttons) => {
        const button = /** @type {HTMLButtonElement[]} */ (buttons).find((node) => !node.disabled && node.getClientRects().length);
        button?.click();
      });
      return (await page.locator('.immersive-title-row button.immersive-stat-value').count()) === 1;
    }, 'editable local hull CSV override');
    await page.locator('.immersive-title-row .immersive-stat-value').click();
    await page.locator('.immersive-field-popover input').first().fill('Validated name');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await until(async () => {
      const confirm = page.locator('[role="dialog"]').getByRole('button', { name: /^(保存|创建本地覆盖|仍然保存)$/ });
      await confirm.evaluateAll((buttons) => {
        const button = /** @type {HTMLButtonElement[]} */ (buttons).find((node) => !node.disabled && node.getClientRects().length);
        button?.click();
      });
      return (await page.locator('.immersive-actions [role="status"]').textContent()) === '已保存';
    }, 'validated local override save');
    assert.match(await readFile(join(validationMod, 'data/hulls/ship_data.csv'), 'utf8'), /Validated name/);
    assert.equal(await page.locator('.editor-problem.error:visible').count(), 0);
    await page.screenshot({ path: join(artifacts, 'validation-wing-saved.png') });
    await page.locator('.immersive-actions').getByRole('button', { name: '关闭', exact: true }).click();
    await until(() => page.isClosed(), 'validation wing normal close');
  });
  await check('Java source creation and deletion refresh the live script validation', async () => {
    await active.evaluate(
      stores +
        '.get("csv-editor").switchTab(window.__desktopTarget.modRoot,"marketConditions");' +
        stores +
        '.get("workspace").activateModTable(window.__desktopTarget.modRoot)',
    );
    const document = stores + '.get("csv-editor").getCsvModState(window.__desktopTarget.modRoot).documents.marketConditions';
    await waitFor(active, document + '.validationContext?.classes["probe.Script"]===false');
    const script = join(validationMod, 'src/probe/Script.java');
    await writeFile(script, 'package probe; public class Script {}', 'utf8');
    await waitFor(active, document + '.validationContext?.classes["probe.Script"]===true');
    await unlink(script);
    await waitFor(active, document + '.validationContext?.classes["probe.Script"]===false');
    await active.screenshot({ path: join(artifacts, 'validation-script-refresh.png') });
  });
  return { environment: app.environment, sample: { source: fixture.source, rows: 2 }, validation: { hulls: 200, wings: 31 } };
}
