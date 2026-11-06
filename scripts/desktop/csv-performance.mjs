import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { summarize } from '../shared/sample-statistics.mjs';
import { root, stores } from './config.mjs';
import { openMod, waitFor } from './runtime.mjs';

/** @param {{launch:()=>ReturnType<typeof import('./runtime.mjs').startDesktop>,close:(app:Awaited<ReturnType<typeof import('./runtime.mjs').startDesktop>>)=>Promise<void>,fixture:Awaited<ReturnType<typeof import('./sample.mjs').prepareSample>>,check:(name:string,operation:()=>Promise<void>)=>Promise<void>,options:{rounds:number,phase:string,screenshots:boolean},artifacts:string}} context */
export async function csvPerformance({ launch, close, fixture, check, options, artifacts }) {
  /** @type {{name:string,round:number,ms:number,namesMs:number,imagesMs:number}[]} */
  const samples = [];
  const source = await readFile(resolve(root, 'src/test/desktop/csv-audit.ts'), 'utf8');
  const probe = ts
    .transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } })
    .outputText.replace('export function installCsvAudit', 'function installCsvAudit');
  let environment = {};
  /** @type {Record<string,{rows:number,columns:number}>} */
  const tables = {};
  /** @param {Awaited<ReturnType<typeof import('./runtime.mjs').startDesktop>>} app */
  async function prepare(app) {
    await app.session.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 860, deviceScaleFactor: 1.5, mobile: false });
    await openMod(app.main, fixture.mod, fixture.game, 'commodities');
    await waitFor(app.main, '!!document.querySelector(".mod-navigation-button")');
    await app.main.evaluate('(()=>{' + probe + ';return installCsvAudit()})()');
    const viewport = await app.main.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
    assert.deepEqual(viewport, { width: 1360, height: 860, dpr: 1.5 });
    environment = { ...app.environment, ...viewport };
    return app;
  }
  /** @param {Awaited<ReturnType<typeof import('./runtime.mjs').startDesktop>>} app @param {string} name @param {string} label @param {string} operation @param {number} round */
  async function sample(app, name, label, operation, round) {
    const result = await app.main.evaluate(
      '__csvBench.measure(' + JSON.stringify(label) + ',' + JSON.stringify(operation) + ',' + round + ')',
    );
    samples.push({ name, round, ...result });
    tables[label === '舰船' ? 'ships' : 'weapons'] = { rows: result.totalRows, columns: result.totalColumns };
  }
  if (options.phase !== 'warm')
    for (let round = 0; round < options.rounds; round++) {
      const app = await launch();
      try {
        await prepare(app);
        await check('first-ships:' + round, () => sample(app, 'first-ships', '舰船', 'switch', round));
        await check('first-weapons:' + round, () => sample(app, 'first-weapons', '武器', 'switch', round));
      } finally {
        await close(app);
      }
    }
  if (options.phase !== 'cold') {
    const app = await launch();
    try {
      await prepare(app);
      await app.main.evaluate('__csvBench.measure("舰船","switch",0)');
      await app.main.evaluate('__csvBench.measure("武器","switch",0)');
      for (let round = 0; round < options.rounds; round++) {
        for (const [name, label, operation] of /** @type {[string,string,string][]} */ ([
          ['switch-ships', '舰船', 'switch'],
          ...['tail', 'top', 'right', 'left', 'vertical', 'horizontal', 'continuous'].map((operation) => [operation, '舰船', operation]),
          ['switch-weapons', '武器', 'switch'],
        ])) {
          await check(name + ':' + round, () => sample(app, name, label, operation, round));
        }
      }
      if (options.screenshots)
        for (const theme of ['dark', 'light'])
          for (const width of [1360, 1100]) {
            await app.main.evaluate(stores + '.get("settings").setTheme(' + JSON.stringify(theme) + ')');
            await app.main.setViewportSize({ width, height: 860 });
            await app.main.screenshot({ path: join(artifacts, 'csv-' + theme + '-' + width + '.png') });
          }
    } finally {
      await close(app);
    }
  }
  const statistics = Object.fromEntries(
    [...new Set(samples.map((sample) => sample.name))].map((name) => {
      const rows = samples.filter((sample) => sample.name === name);
      return [
        name,
        {
          ms: summarize(rows.map((row) => row.ms)),
          namesMs: summarize(rows.map((row) => row.namesMs)),
          imagesMs: summarize(rows.map((row) => row.imagesMs)),
        },
      ];
    }),
  );
  await writeFile(join(artifacts, 'samples.json'), JSON.stringify({ samples, statistics }, null, 2) + '\n', 'utf8');
  return {
    environment,
    sample: { source: fixture.source, tables },
    samples,
    statistics,
    budget: { visibleFieldsP95Ms: 200, pass: Object.values(statistics).every((result) => result.ms.p95 <= 200) },
  };
}
