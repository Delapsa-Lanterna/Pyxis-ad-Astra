import assert from 'node:assert/strict';
import { cp, readFile, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { createTestRun } from '../../shared/test-report.mjs';
import { until } from '../runtime.mjs';
import { installWorkspaceTiming, summarizeWorkspaceTiming } from '../workspace-timing.mjs';

/** @typedef {import('../../../src/shared/types/json.types.js').JsonValue} JsonValue */
/** @typedef {import('../../../src/shared/types/project-identity.types.js').CsvTableKey} CsvTableKey */
/** @typedef {{sessionId:string,modRoot:string,modInfo:Record<string,JsonValue>|null,tableSummaries:Record<CsvTableKey,{available:boolean}>}} OpeningManifest */
/** @typedef {{starsectorRoot:string,mods:{modRoot:string}[]}} GameSnapshot */
/** @typedef {{selected:string|null,commands:string[],detection:{kind:string,overview:GameSnapshot|null}|null,manifest:OpeningManifest|null,index:{table:CsvTableKey,totalRows:number}|null}} OpeningAudit */
/** @typedef {{modRoot:string,displayName:string,status:string,version:string,sessionId:string|null}} OpenedMod */
/** @typedef {{view:string,game:GameSnapshot|null,mods:OpenedMod[],manifests:OpeningManifest[],audit:OpeningAudit}} OpeningSnapshot */
const pathKey = (/** @type {string} */ value) =>
  value
    .replace(/^\\\\\?\\/, '')
    .replaceAll('\\', '/')
    .toLowerCase();

/** @param {import('./registry.mjs').DesktopCase} context */
export async function workspaceOpening({ launch, close, fixture, check, runs, options, artifacts }) {
  const sources = await Promise.all(
    [
      '../../../src/shared/lib/starsector/tables.ts',
      '../../../src/shared/lib/starsector/value.ts',
      '../../../src/test/desktop/csv-audit.ts',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  );
  const compiled = ts.transpileModule(sources.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  }).outputText;
  const ui =
    /** @type {{MODULE_LABELS:Record<CsvTableKey,string>,cell:(value:unknown)=>string,formatModVersion:(value:JsonValue|undefined)=>string,installCsvAudit:()=>unknown}} */ (
      await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
    );
  const selected = options.mod ?? options.game;
  /** @type {{name:string,selected:string,root:string|null,game?:string,primary:boolean}[]} */
  let routes;
  if (selected) {
    routes = [{ name: 'selected', selected, root: options.mod ?? null, game: options.mod ? options.game : undefined, primary: true }];
  } else {
    const external = join(fixture.game, '..', 'external-mod');
    await cp(fixture.mod, external, { recursive: true });
    const info = { ...JSON.parse(await readFile(fixture.descriptor, 'utf8')), id: 'external_sample', name: 'External sample' };
    await writeFile(join(external, 'mod_info.json'), JSON.stringify(info), 'utf8');
    routes = [
      { name: 'mod-in-game', selected: fixture.mod, root: fixture.mod, primary: true },
      { name: 'external-mod', selected: external, root: external, primary: false },
      { name: 'game-root', selected: fixture.game, root: fixture.mod, primary: false },
    ];
  }
  for (const route of routes) {
    const app = await launch(),
      page = app.main;
    /** @type {import('../../shared/test-report.mjs').TestRun[]} */
    const routeRuns = [];
    try {
      await page.getByRole('button', { name: '打开目录', exact: true }).waitFor();
      await page.evaluate(installWorkspaceTiming);
      await page.evaluate(() => {
        const original = globalThis.window.fetch;
        const state = /** @type {OpeningAudit} */ ({ selected: null, commands: [], detection: null, manifest: null, index: null });
        Reflect.set(globalThis, '__workspaceOpening', state);
        // Tauri freezes invoke; replace only the picker response at the fetch boundary.
        globalThis.window.fetch = async function (input, init) {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.hostname !== 'ipc.localhost') return original.call(this, input, init);
          const command = decodeURIComponent(url.pathname.slice(1));
          state.commands.push(command);
          const timing = Reflect.get(globalThis, '__openingTiming');
          const call = {
            command,
            request: new Headers(init?.headers).get('x-performance-request'),
            start: timing.now(),
            response: 0,
            audited: 0,
          };
          timing.commands.push(call);
          if (command === 'plugin:dialog|open') {
            const options = JSON.parse(String(/** @type {RequestInit} */ (init).body));
            if (!options.options.directory) throw Error('Expected directory selection');
            call.response = call.audited = timing.now();
            return new Response(JSON.stringify(state.selected), {
              headers: { 'Tauri-Response': 'ok', 'Content-Type': 'application/json' },
            });
          }
          const response = await original.call(this, input, init);
          call.response = timing.now();
          if (command === 'detect_directory') state.detection = await response.clone().json();
          if (command === 'open_project_session') state.manifest = await response.clone().json();
          if (command === 'query_csv_table_index') state.index = await response.clone().json();
          call.audited = timing.now();
          return response;
        };
      });
      /** @returns {Promise<OpeningSnapshot>} */
      const snapshot = () =>
        page.evaluate(() => {
          const stores = Reflect.get(/** @type {HTMLElement} */ (globalThis.document.querySelector('#app')), '__vue_app__').config
            .globalProperties.$pinia._s;
          const workspace = stores.get('workspace'),
            project = stores.get('project');
          return {
            view: workspace.currentView,
            game: workspace.gameOverview,
            mods: workspace.loadedModList.map((/** @type {OpenedMod} */ mod) => ({ ...mod, sessionId: project.getSessionId(mod.modRoot) })),
            manifests: [...project.manifests.values()],
            audit: Reflect.get(globalThis, '__workspaceOpening'),
          };
        });
      /** @param {string|null} selected @param {boolean} [repeat] */
      async function select(selected, repeat = false, name = 'directory') {
        await page.evaluate(
          ({ selected, name }) => {
            const state = Reflect.get(globalThis, '__workspaceOpening');
            state.selected = selected;
            state.commands = [];
            state.detection = null;
            state.manifest = null;
            state.index = null;
            Reflect.get(globalThis, '__openingTiming').begin(name, () => {
              const stores = Reflect.get(/** @type {HTMLElement} */ (globalThis.document.querySelector('#app')), '__vue_app__').config
                .globalProperties.$pinia._s;
              return (
                state.commands.includes('plugin:dialog|open') &&
                (!selected || state.detection !== null) &&
                stores.get('workspace').loadedModList.every((/** @type {OpenedMod} */ mod) => mod.status === 'ready') &&
                !globalThis.document.body.textContent?.includes('正在打开目录…')
              );
            });
          },
          { selected, name },
        );
        const began = performance.now();
        if (repeat)
          await page.evaluate(() => {
            const host = /** @type {HTMLElement} */ (globalThis.document.querySelector('#app'));
            const nodes = [Reflect.get(host, '__vue_app__')._container._vnode];
            while (nodes.length) {
              const node = nodes.pop();
              if (node.component?.type.__name === 'OverviewPage') {
                Reflect.get(globalThis, '__openingTiming').action();
                node.component.emit('import-mod');
                return;
              }
              if (node.component) nodes.push(node.component.subTree);
              if (Array.isArray(node.children)) nodes.push(...node.children);
              if (node.suspense) nodes.push(node.suspense.activeBranch);
            }
            throw Error('Workspace overview component not found');
          });
        else await page.getByRole('button', { name: '打开目录', exact: true }).click();
        await finish(name);
        return performance.now() - began;
      }
      /** @param {string} name */
      async function finish(name) {
        await until(
          () =>
            page.evaluate(
              (name) =>
                Boolean(
                  Reflect.get(globalThis, '__openingTiming').phases.findLast(
                    (/** @type {import('../workspace-timing.mjs').OpeningPhase} */ phase) => phase.name === name,
                  )?.painted,
                ),
              name,
            ),
          name + ' ready and painted',
        );
        await page.evaluate((name) => Reflect.get(globalThis, '__openingTiming').finish(name), name);
      }
      /** @param {string} name @param {() => Promise<Record<string,number>>} operation */
      async function record(name, operation) {
        const offset = await page.evaluate(() => {
          const timing = Reflect.get(globalThis, '__openingTiming');
          return { phases: timing.phases.length, commands: timing.commands.length };
        });
        const run = createTestRun({
          scenario: 'workspace-opening',
          parameters: { route: route.name, operation: name, selected: route.selected, game: route.game ?? '' },
          units: { directory: 'ms', workspace: 'ms', firstTable: 'ms', gameDirectory: 'ms' },
          execution: 'native',
          environment: app.environment,
          completion: '正式目录打开流程完成；工作区、会话、可视文件内容与样本一致，并完成绘制',
          warmup: 0,
          rounds: 1,
          samples: [],
          resources: { released: false, directorySelection: 'controlled plugin result' },
        });
        runs.push(run);
        routeRuns.push(run);
        await check(name + ':' + route.name, async () => {
          try {
            const metrics = await operation();
            run.samples.push({
              iteration: 0,
              phase: 'measurement',
              metrics,
              assertions: [{ name: '工作区链路结果', pass: true, actual: name, expected: name }],
            });
          } finally {
            run.resources.snapshot = await snapshot();
            run.resources.timing = await page.evaluate((offset) => {
              const timing = Reflect.get(globalThis, '__openingTiming');
              return { phases: timing.phases.slice(offset.phases), commands: timing.commands.slice(offset.commands) };
            }, offset);
          }
        });
      }
      if (route.primary)
        await record('cancel-selection', async () => {
          const before = await snapshot(),
            milliseconds = await select(null),
            after = await snapshot();
          assert.deepEqual(after.mods, before.mods);
          assert.deepEqual(after.manifests, before.manifests);
          assert.equal(after.view, before.view);
          assert.equal(after.game, before.game);
          assert.ok(after.audit.commands.every((command) => !['detect_directory', 'open_project_session'].includes(command)));
          return { directory: milliseconds };
        });
      await record('open', async () => {
        const began = performance.now();
        await page.evaluate((root) => {
          Reflect.get(globalThis, '__openingTiming').begin('workspace', () => {
            const stores = Reflect.get(/** @type {HTMLElement} */ (globalThis.document.querySelector('#app')), '__vue_app__').config
              .globalProperties.$pinia._s;
            const workspace = stores.get('workspace'),
              audit = Reflect.get(globalThis, '__workspaceOpening');
            if (!root)
              return Boolean(
                audit.detection &&
                workspace.gameOverview &&
                globalThis.document.querySelectorAll('.overview-mod-card').length === workspace.gameOverview.mods.length,
              );
            return Boolean(
              audit.manifest &&
              workspace.loadedModList.some(
                (/** @type {OpenedMod} */ mod) =>
                  stores.get('project').getSessionId(mod.modRoot) === audit.manifest.sessionId && mod.status === 'ready',
              ) &&
              globalThis.document.querySelector('.mod-overview-page .page-title') &&
              globalThis.document.querySelector('.mod-navigation-button'),
            );
          });
        }, route.root);
        const metrics = /** @type {Record<string,number>} */ ({});
        if (route.game) {
          metrics.gameDirectory = await select(route.game, false, 'gameDirectory');
          const game = await snapshot();
          assert.equal(game.audit.detection?.kind, 'game-root');
          assert.ok(game.game);
          assert.equal(pathKey(game.game.starsectorRoot), pathKey(await realpath(route.game)));
        }
        metrics.directory = await select(route.selected, Boolean(route.game));
        const opened = await snapshot();
        assert.ok(opened.audit.detection);
        if (route.name !== 'selected') assert.equal(opened.audit.detection.kind, route.name);
        assert.equal(opened.audit.commands.filter((command) => command === 'detect_directory').length, 1);
        if (!route.root) {
          assert.equal(opened.audit.detection.kind, 'game-root');
          assert.ok(opened.game);
          assert.equal(pathKey(opened.game.starsectorRoot), pathKey(await realpath(route.selected)));
          assert.deepEqual(opened.game.mods, opened.audit.detection.overview?.mods);
          assert.equal(await page.locator('.overview-mod-card').count(), opened.game.mods.length);
          assert.equal(opened.mods.length, 0);
          await finish('workspace');
          metrics.workspace = performance.now() - began;
          return metrics;
        }
        const root = pathKey(await realpath(route.root));
        if (opened.audit.detection.kind !== 'external-mod') {
          assert.equal(opened.view, 'overview');
          assert.ok(opened.game);
          const target = opened.game.mods.find((mod) => pathKey(mod.modRoot) === root);
          assert.ok(target);
          const card = page.locator('.overview-mod-card').filter({ has: page.getByText(target.modRoot, { exact: true }) });
          await card
            .getByRole('button', {
              name: opened.audit.detection.kind === 'game-root' ? '打开' : '进入编辑',
              exact: true,
            })
            .click();
        }
        await until(
          () => page.evaluate(() => Reflect.get(globalThis, '__workspaceOpening').manifest !== null),
          'project manifest received',
        );
        const native = (await snapshot()).audit.manifest;
        assert.ok(native);
        const title = ui.cell(native.modInfo?.name) || 'Mod 概览';
        await page.locator('.mod-overview-page .page-title').filter({ hasText: title }).waitFor();
        await page.locator('.mod-navigation-button').first().waitFor();
        await finish('workspace');
        metrics.workspace = performance.now() - began;
        const state = await snapshot(),
          mod = state.mods[0],
          manifest = state.manifests[0];
        assert.equal(state.mods.length, 1);
        assert.equal(state.manifests.length, 1);
        assert.ok(mod);
        assert.ok(manifest);
        assert.equal(pathKey(mod.modRoot), root);
        assert.equal(pathKey(manifest.modRoot), pathKey(mod.modRoot));
        assert.equal(mod.status, 'ready');
        assert.deepEqual(manifest.modInfo, native.modInfo);
        assert.equal(mod.version, ui.formatModVersion(native.modInfo?.version));
        assert.equal((await page.locator('.mod-overview-header-description').textContent())?.trim(), mod.version || '未声明版本');
        assert.equal(mod.sessionId, native.sessionId);
        assert.equal(manifest.sessionId, native.sessionId);
        assert.equal(state.audit.commands.filter((command) => command === 'open_project_session').length, 1);
        const labels = await page.locator('.mod-navigation-button-label:first-child').allTextContents();
        const first = Object.entries(ui.MODULE_LABELS)
          .filter(([key]) => native.tableSummaries[/** @type {keyof typeof ui.MODULE_LABELS} */ (key)].available)
          .sort((left, right) => labels.indexOf(left[1]) - labels.indexOf(right[1]))[0];
        if (first) {
          const [table, label] = first;
          await page.evaluate(ui.installCsvAudit);
          const tableBegan = performance.now();
          await page.evaluate(
            ({ table, label }) => {
              Reflect.get(globalThis, '__openingTiming').begin('firstTable', () => {
                const index = Reflect.get(globalThis, '__workspaceOpening').index;
                return (
                  index?.table === table &&
                  (index.totalRows
                    ? Reflect.get(globalThis, '__csvBench').ready(label)
                    : Boolean(globalThis.document.querySelector('.csv-editor-page')))
                );
              });
            },
            { table, label },
          );
          await page
            .locator('.mod-navigation-button')
            .filter({
              has: page.getByText(label, { exact: true }),
            })
            .click();
          await until(
            () => page.evaluate((table) => Reflect.get(globalThis, '__workspaceOpening').index?.table === table, table),
            'first table received',
          );
          const rows = await page.evaluate(() => Reflect.get(globalThis, '__workspaceOpening').index.totalRows);
          await finish('firstTable');
          if (rows) {
            const visible = await page.evaluate((label) => Reflect.get(globalThis, '__csvBench').measure(label, 'observe', 0), label);
            const calls = await page.evaluate(() => Reflect.get(globalThis, '__csvBench').calls);
            assert.ok(calls.some((/** @type {{command:string}} */ call) => call.command === 'query_csv_table_index'));
            assert.ok(
              calls
                .filter((/** @type {{command:string}} */ call) => call.command === 'query_csv_source_options')
                .every((/** @type {{end:number|null}} */ call) => call.end !== null),
            );
            const run = routeRuns.at(-1);
            assert.ok(run);
            run.resources.firstTable = { visible, calls };
          } else {
            await page.locator('.csv-editor-page').waitFor();
            assert.equal(await page.locator('.csv-grid-row[data-row-key]').count(), 0);
          }
          metrics.firstTable = performance.now() - tableBegan;
        }
        await page.getByRole('button', { name: '打开工作区总览', exact: true }).click();
        return metrics;
      });
      if (route.primary && route.root)
        await record('reopen-existing', async () => {
          const before = await snapshot(),
            directory = await select(route.selected, true),
            after = await snapshot();
          assert.deepEqual(after.mods, before.mods);
          assert.deepEqual(after.manifests, before.manifests);
          assert.equal(after.audit.commands.filter((command) => command === 'detect_directory').length, 1);
          assert.equal(after.audit.commands.filter((command) => command === 'open_project_session').length, 0);
          assert.equal(await page.locator('.mod-tab').count(), 1);
          return { directory };
        });
    } finally {
      try {
        const status = await page.evaluate(() =>
          Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('performance_monitor_report', { action: 'export' }),
        );
        assert.equal(status.enabled, true);
        assert.equal(status.overwritten, 0);
        const path = join(artifacts, 'workspace-' + route.name + '-native.json');
        await cp(status.path, path);
        const native = JSON.parse(await readFile(path, 'utf8'));
        const completed = await page.evaluate(() => Reflect.get(globalThis, '__openingTiming').commands);
        for (const run of routeRuns) {
          const raw =
            /** @type {{phases:import('../workspace-timing.mjs').OpeningPhase[],commands:import('../workspace-timing.mjs').OpeningCommand[]}} */ (
              run.resources.timing
            );
          const calls = raw.commands.map((call) =>
            completed.find(
              (/** @type {import('../workspace-timing.mjs').OpeningCommand} */ current) =>
                current.start === call.start && current.command === call.command,
            ),
          );
          const timing = summarizeWorkspaceTiming(raw.phases, calls, native.traceEvents);
          run.resources.timing = { ...timing, nativeReport: path, monitor: status };
          for (const sample of run.samples) Object.assign(sample.metrics, timing.metrics);
          for (const key of Object.keys(timing.metrics)) run.units[key] = 'ms';
        }
      } finally {
        try {
          await page.evaluate(() => Reflect.get(globalThis, '__openingTiming').stop());
        } finally {
          await close(app);
        }
      }
    }
  }
  return { directorySelection: 'controlled plugin result', openingCases: runs.length };
}
