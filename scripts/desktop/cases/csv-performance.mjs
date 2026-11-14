import { appThemes } from '../../shared/app-themes.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { summarize } from '../../shared/sample-statistics.mjs';
import { createTestRun } from '../../shared/test-report.mjs';
import { root, stores } from '../config.mjs';
import { openMod, waitFor, until } from '../runtime.mjs';

/** @param {{launch:()=>ReturnType<typeof import('../runtime.mjs').startDesktop>,close:(app:Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>)=>Promise<void>,fixture:Awaited<ReturnType<typeof import('../sample.mjs').prepareSample>>,check:(name:string,operation:()=>Promise<void>)=>Promise<void>,options:{rounds:number,warmup:number,phase:string,screenshots:boolean},artifacts:string,runs:import('../../shared/test-report.mjs').TestRun[]}} context */
export async function csvPerformance({ launch, close, fixture, check, options, artifacts, runs }) {
  if (fixture.source === 'generated') {
    const defaults = JSON.parse(await readFile(resolve(root, 'schemas/spec-defaults.json'), 'utf8'));
    await mkdir(join(fixture.mod, 'data/hulls'), { recursive: true });
    for (let index = 0; index < fixture.count; index++)
      await writeFile(
        join(fixture.mod, 'data/hulls/ship_' + index + '.ship'),
        JSON.stringify({ ...defaults.ship, hullId: 'ship_' + index, hullName: 'Sample ship ' + index }),
        'utf8',
      );
  }
  /** @type {{name:string,round:number,ms:number,namesMs:number,imagesMs:number}[]} */
  const samples = [];
  const source = await readFile(resolve(root, 'src/test/desktop/csv-audit.ts'), 'utf8');
  const probe = ts
    .transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } })
    .outputText.replace('export function installCsvAudit', 'function installCsvAudit');
  let environment = /** @type {Record<string,unknown>} */ ({});
  /** @type {Record<string,{rows:number,columns:number}>} */
  const tables = {};
  /** @param {Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>} app */
  async function prepare(app) {
    await app.main.evaluate(stores + '.get("settings").setIgnoreEditorWarnings(true)');
    await app.main.evaluate(async () => {
      const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke;
      const settings = await invoke('read_settings');
      await invoke('save_settings', { payload: { settings: { ...settings.value, ignoreEditorWarnings: true } } });
    });
    await app.session.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 860, deviceScaleFactor: 1.5, mobile: false });
    await openMod(app.main, fixture.mod, fixture.game, 'commodities');
    await waitFor(app.main, '!!document.querySelector(".mod-navigation-button")');
    await app.main.evaluate('(()=>{' + probe + ';return installCsvAudit()})()');
    const viewport = await app.main.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
    assert.deepEqual(viewport, { width: 1360, height: 860, dpr: 1.5 });
    environment = { ...app.environment, ...viewport };
    return app;
  }
  /** @param {Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>} app @param {string} name @param {string} label @param {string} operation @param {number} round */
  async function sample(app, name, label, operation, round) {
    const result = await app.main.evaluate(
      '__csvBench.measure(' + JSON.stringify(label) + ',' + JSON.stringify(operation) + ',' + round + ')',
    );
    samples.push({ name, round, ...result });
    tables[label === '舰船' ? 'ships' : 'weapons'] = { rows: result.totalRows, columns: result.totalColumns };
    let run = runs.find((run) => run.scenario === 'csv' && run.parameters.operation === name);
    if (!run) {
      run = createTestRun({
        scenario: 'csv',
        parameters: { operation: name, rows: result.totalRows, columns: result.totalColumns },
        units: { rows: 'rows', columns: 'columns' },
        execution: 'native',
        completion: '可视字段与引用名称就绪，并完成所属绘制帧',
        environment,
        warmup: options.warmup,
        rounds: options.rounds,
        samples: [],
        resources: { released: false },
      });
      runs.push(run);
    }
    run.samples.push({
      iteration: round,
      phase: round < 0 ? 'warmup' : 'measurement',
      metrics: {
        visibleFields: result.ms,
        names: result.namesMs,
        images: result.imagesMs,
        ...(operation === 'roundTrip' || operation === 'traverse' ? { [operation]: result.operationMilliseconds } : {}),
      },
      assertions: [],
    });
  }
  if (options.phase !== 'warm')
    for (let round = -options.warmup; round < options.rounds; round++) {
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
      for (let round = -options.warmup; round < options.rounds; round++) {
        for (const [name, label, operation] of /** @type {[string,string,string][]} */ ([
          ['switch-ships', '舰船', 'switch'],
          ...['tail', 'top', 'right', 'left', 'vertical', 'horizontal', 'continuous', 'roundTrip', 'traverse'].map((operation) => [
            operation,
            '舰船',
            operation,
          ]),
          ['switch-weapons', '武器', 'switch'],
        ])) {
          await check(name + ':' + round, () => sample(app, name, label, operation, round));
        }
        await check('edit-save-reopen-close:' + round, async () => {
          await app.main.evaluate('__csvBench.measure("舰船","switch",0)');
          await app.main.evaluate('__csvBench.measure("舰船","top",0)');
          const row = app.main.locator('.csv-grid-row[data-row-key]').nth(1);
          const metrics = /** @type {Record<string,number>} */ ({});
          let began = performance.now();
          await row.locator('[data-column-key="name"]').dblclick();
          const input = app.main.locator('.csv-cell-editor input,.csv-cell-text-editor textarea');
          await input.waitFor();
          metrics.activate = performance.now() - began;
          const value = 'Measurement_csv_' + (round + options.warmup);
          began = performance.now();
          await input.fill(value);
          await input.press('Tab');
          await input.waitFor({ state: 'hidden' });
          metrics.input = performance.now() - began;
          began = performance.now();
          const saving = app.main.evaluate(async () => {
            const { document, window } = globalThis;
            const csv = Reflect.get(
              /** @type {HTMLElement} */ (document.querySelector('#app')),
              '__vue_app__',
            ).config.globalProperties.$pinia._s.get('csv-editor');
            const target = Reflect.get(window, '__desktopTarget');
            await csv.getTableEditor({ sessionId: target.sessionId, modRoot: target.modRoot, table: 'ships' }).save();
          });
          await Promise.all([
            saving,
            until(async () => {
              const confirm = app.main.getByRole('dialog').getByRole('button', { name: '仍然保存', exact: true });
              if (await confirm.count()) await confirm.evaluate((button) => /** @type {HTMLButtonElement} */ (button).click());
              return app.main.evaluate(() => {
                const csv = Reflect.get(
                  /** @type {HTMLElement} */ (globalThis.document.querySelector('#app')),
                  '__vue_app__',
                ).config.globalProperties.$pinia._s.get('csv-editor');
                const target = Reflect.get(globalThis, '__desktopTarget');
                return (
                  !csv.hasTableDirtyChanges({ sessionId: target.sessionId, modRoot: target.modRoot, table: 'ships' }) &&
                  !csv.isTableSaving(target.modRoot, 'ships')
                );
              });
            }, 'CSV save accepted'),
          ]);
          metrics.save = performance.now() - began;
          const disk = await readFile(join(fixture.mod, 'data/hulls/ship_data.csv'), 'utf8');
          assert.ok(disk.includes(value));
          began = performance.now();
          await app.main.evaluate('__csvBench.measure("武器","switch",0)');
          metrics.close = performance.now() - began;
          began = performance.now();
          await app.main.evaluate('__csvBench.measure("舰船","switch",0)');
          await app.main.locator('.table-panel').getByText(value, { exact: true }).waitFor();
          metrics.reopen = performance.now() - began;
          let run = runs.find((run) => run.parameters.operation === 'edit-save-reopen-close');
          if (!run) {
            run = createTestRun({
              scenario: 'csv',
              parameters: { operation: 'edit-save-reopen-close', rows: fixture.count, columns: 40 },
              units: { rows: 'rows', columns: 'columns' },
              execution: 'native',
              completion: '提交输入、保存回执接纳及磁盘内容核对；重新打开显示保存值',
              environment,
              warmup: options.warmup,
              rounds: options.rounds,
              samples: [],
              resources: { released: false },
            });
            runs.push(run);
          }
          run.samples.push({
            iteration: round,
            phase: round < 0 ? 'warmup' : 'measurement',
            metrics,
            assertions: [{ name: 'CSV 保存及重新读取', pass: true, actual: value, expected: value }],
          });
        });
      }
      if (options.screenshots)
        for (const theme of [...appThemes].reverse())
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
      const rows = samples.filter((sample) => sample.name === name && sample.round >= 0);
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
  };
}
