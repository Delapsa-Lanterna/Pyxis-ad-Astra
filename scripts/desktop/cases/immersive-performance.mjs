import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestRun } from '../../shared/test-report.mjs';
import { until, openImmersiveWindow } from '../runtime.mjs';
import { prepareImmersiveSample } from '../sample.mjs';
import { immersiveTargets } from '../../shared/performance-scenarios.mjs';

/** @typedef {{command:string,start:number,duration:number}} CommandSample */
/** @typedef {{root:{id:string},bindings:Record<string,string>,records:{key:string,target:{kind:string,rowKey:string,write:{path:string},target:{write:{path:string}}}}[]}} JointSnapshot */

/** @param {import('./registry.mjs').DesktopCase} context */
export async function immersivePerformance({ launch, fixture, check, options, artifacts, runs }) {
  assert.equal(options.mod, undefined, 'Immersive measurements use generated samples');
  const mod = fixture.mod;
  await prepareImmersiveSample(fixture, options.count);
  const app = await launch();
  await app.main.evaluate(async () => {
    const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke;
    const settings = await invoke('read_settings');
    await invoke('save_settings', {
      payload: {
        settings: { ...settings.value, ignoreEditorWarnings: true, immersiveGameFont: false, watchFileChanges: false, logLevel: 'error' },
      },
    });
  });
  const manifest = /** @type {{sessionId:string,modRoot:string}} */ (
    await app.main.evaluate(
      (modRoot) =>
        Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_project_session', { payload: { modRoot, starsectorRoot: null } }),
      mod,
    )
  );
  await app.main.evaluate(
    'document.querySelector("#app").__vue_app__.config.globalProperties.$pinia._s.get("project").registerProjectManifest(' +
      JSON.stringify(manifest) +
      ')',
  );
  for (const target of immersiveTargets) {
    const query = {
      root: { sessionId: manifest.sessionId, modRoot: manifest.modRoot, kind: target.kind, id: target.id },
      rowKey: null,
      values: null,
      newSources: [],
      catalog: null,
    };
    const firstRead = /** @type {{milliseconds:number,snapshot:JointSnapshot}} */ (
      await app.main.evaluate(async (query) => {
        const began = performance.now();
        const snapshot = await Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('query_joint_edit', { payload: query });
        return { milliseconds: performance.now() - began, snapshot };
      }, query)
    );
    const row = firstRead.snapshot.records.find((record) => record.key === firstRead.snapshot.bindings.csv);
    const { editor, session, viewport, firstOpen, firstOpenEnvironment } = await openImmersiveWindow(
      app,
      query.root,
      target.kind === 'wing' ? (row?.target.rowKey ?? null) : null,
    );
    const commandSamples = /** @type {{iteration:number,calls:CommandSample[]}[]} */ ([]);
    const run = createTestRun({
      scenario: 'immersive-' + target.kind,
      parameters: { unrelatedVariants: options.count, operation: 'read-save' },
      units: { unrelatedVariants: 'files', read: 'ms', save: 'ms', commands: 'calls' },
      execution: 'native',
      completion: '正式联合读取返回；字段输入提交后保存，磁盘包含提交值、已保存状态及随后绘制帧',
      environment: { ...app.environment, ...viewport, monitor: false, cache: 'application default', core: false },
      warmup: options.warmup,
      rounds: options.rounds,
      samples: [],
      resources: {
        released: false,
        firstRead: firstRead.milliseconds,
        firstOpen,
        firstOpenEnvironment,
        snapshotRecords: firstRead.snapshot.records.length,
        snapshotBytes: Buffer.byteLength(JSON.stringify(firstRead.snapshot), 'utf8'),
        commands: commandSamples,
      },
    });
    runs.push(run);
    try {
      for (let iteration = -options.warmup; iteration < options.rounds; iteration++) {
        await check(target.kind + ':' + iteration, async () => {
          const read = await app.main.evaluate(async (query) => {
            const began = performance.now();
            const snapshot = await Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('query_joint_edit', { payload: query });
            return { milliseconds: performance.now() - began, id: snapshot.root.id };
          }, query);
          assert.equal(read.id, target.id);
          const next = 'Measurement_' + target.kind + '_' + (iteration + options.warmup);
          const stat = editor
            .locator('.immersive-stat-row')
            .filter({ has: editor.locator('.immersive-stat-row-label', { hasText: target.label }) })
            .first();
          await stat.locator('button').click();
          const input = editor.locator('.immersive-field-popover input:not([disabled])').last();
          await input.fill(next);
          await input.press('Enter');
          await until(() => editor.locator('[role=status]').filter({ hasText: '未保存' }).count(), 'edited draft ready');
          await editor.evaluate(() => {
            Reflect.get(globalThis, '__immersiveCalls').length = 0;
          });
          const save = /** @type {{milliseconds:number,calls:CommandSample[]}} */ (
            await editor.evaluate(async () => {
              const { document, requestAnimationFrame } = globalThis;
              const began = performance.now();
              const save = /** @type {HTMLButtonElement} */ (
                [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '保存')
              );
              save.click();
              for (;;) {
                await new Promise((done) => requestAnimationFrame(done));
                const dialog = document.querySelector('[role=dialog]');
                const confirmation =
                  dialog &&
                  [...dialog.querySelectorAll('button')].find((button) => ['保存', '仍然保存'].includes(button.textContent.trim()));
                confirmation?.click();
                if ([...document.querySelectorAll('[role=status]')].some((node) => node.textContent.trim() === '已保存')) {
                  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
                  return {
                    milliseconds: performance.now() - began,
                    calls: Reflect.get(globalThis, '__immersiveCalls').filter((/** @type {CommandSample} */ call) => call.start >= began),
                  };
                }
                if (performance.now() - began > 30000) throw Error('Immersive save timed out: ' + document.body.textContent);
              }
            })
          );
          const disk = await readFile(join(mod, target.file), 'utf8');
          assert.ok(disk.includes(next), 'Saved bytes contain submitted field');
          if (!target.file.endsWith('.csv')) assert.equal(JSON.parse(disk)[target.field], next);
          const writes = save.calls.filter((call) => call.command === 'save_project');
          assert.equal(writes.length, 1, 'One project save command: ' + JSON.stringify(save.calls));
          commandSamples.push({ iteration, calls: save.calls });
          run.samples.push({
            iteration,
            phase: iteration < 0 ? 'warmup' : 'measurement',
            metrics: {
              read: read.milliseconds,
              save: save.milliseconds,
              commands: save.calls.length,
              prepare: save.calls.filter((call) => call.command === 'prepare_joint_edit').reduce((sum, call) => sum + call.duration, 0),
              commit: writes.reduce((sum, call) => sum + call.duration, 0),
              jointReads: save.calls.filter((call) => call.command === 'query_joint_edit').length,
            },
            assertions: [
              { name: '写盘值与提交值一致', pass: true, actual: next, expected: next },
              { name: '一次项目保存', pass: true, actual: writes.length, expected: 1 },
            ],
          });
        });
      }
      await editor.screenshot({ path: join(artifacts, 'immersive-' + target.kind + '.png') });
    } finally {
      await session.detach();
    }
    await editor.locator('.immersive-actions').getByRole('button', { name: '关闭', exact: true }).click();
    await until(() => editor.isClosed(), 'immersive window released');
    const owners = await app.main.evaluate(
      (targets) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('query_edit_target_owners', { targets }),
      firstRead.snapshot.records.map((record) => ({
        sessionId: manifest.sessionId,
        modRoot: manifest.modRoot,
        path: record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path,
      })),
    );
    assert.equal(owners.length, 0);
    run.resources.released = true;
    console.log(JSON.stringify({ kind: target.kind, unrelatedVariants: options.count, measured: options.rounds }));
  }
  return { sample: { ships: 2, weapons: 1, wings: 1, skins: 1, variants: options.count + 2 } };
}
