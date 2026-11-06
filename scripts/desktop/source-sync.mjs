import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { stores, invoke as api } from './config.mjs';
import { openMod, waitFor } from './runtime.mjs';
import { commodityText, sampleInfo } from './sample.mjs';

/** @param {Awaited<ReturnType<typeof import('./runtime.mjs').startDesktop>>} app @param {Awaited<ReturnType<typeof import('./sample.mjs').prepareSample>>} fixture @param {(name:string,operation:()=>Promise<void>)=>Promise<void>} check @param {string} artifacts */
export async function sourceSync(app, fixture, check, artifacts) {
  const { main: active, context } = app;
  const { game, mod, core, table, descriptor, notes } = fixture;
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
      '("request_window",{payload:{identity:{type:"file",sessionId:window.__desktopTarget.sessionId,modRoot:window.__desktopTarget.modRoot,path:' +
      JSON.stringify(notes) +
      '},title:"Source test text",input:{kind:"file-editor",location:{contextLabel:null,contextSeverity:null,message:null,line:null,column:null}},width:1040,height:760,minWidth:780,minHeight:520}})',
  );
  let textPage;
  for (let attempt = 0; attempt < 100; attempt++) {
    textPage = context.pages().find((page) => page !== active && page.url().startsWith('http://tauri.localhost'));
    if (textPage) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(textPage, 'Text editor window is available');
  await textPage.locator('textarea').waitFor();
  await check('Managed window focus reuses the isolated text window', async () => {
    const identity = { type: 'file', sessionId: manifest.sessionId, modRoot: manifest.modRoot, path: notes };
    assert.equal(await active.evaluate(api + '("focus_managed_window",{identity:' + JSON.stringify(identity) + '})'), true);
    assert.equal(context.pages().length, 2);
  });
  await check('Text window keeps its draft and missing-source target after an unpaired native rename', async () => {
    await textPage.locator('textarea').fill('Local text draft');
    await writeFile(notes, 'External text', 'utf8');
    await textPage.getByText('外部文本已更新，当前未保存草稿已保留。', { exact: true }).waitFor();
    assert.equal(await textPage.locator('textarea').inputValue(), 'Local text draft');
    await rename(notes, join(mod, 'renamed.txt'));
    await textPage.locator('.file-editor-message.danger').waitFor();
    assert.equal(await textPage.getByText('保留文本并跟随', { exact: true }).count(), 0);
    assert.equal(await textPage.locator('.file-editor-path').getAttribute('title'), notes);
    assert.equal(await textPage.locator('textarea').inputValue(), 'Local text draft');
  });
  for (const theme of ['light', 'dark'])
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
  return { environment: app.environment, sample: { source: fixture.source, rows: 2 } };
}
