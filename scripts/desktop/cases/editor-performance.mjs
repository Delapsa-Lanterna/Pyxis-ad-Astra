import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestRun } from '../../shared/test-report.mjs';
import { until } from '../runtime.mjs';

/** @param {Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>} app @param {Awaited<ReturnType<typeof import('../sample.mjs').prepareSample>>} fixture @param {(name:string,operation:()=>Promise<void>)=>Promise<void>} check @param {{count:number,rounds:number,warmup:number}} options @param {import('../../shared/test-report.mjs').TestRun[]} runs */
export async function editorPerformance(app, fixture, check, options, runs) {
  const manifest = /** @type {{sessionId:string,modRoot:string}} */ (
    await app.main.evaluate(
      (root) =>
        Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_project_session', { payload: { modRoot: root, starsectorRoot: null } }),
      fixture.mod,
    )
  );
  await app.main.evaluate(async () => {
    const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke,
      settings = await invoke('read_settings');
    settings.value.logLevel = 'debug';
    settings.value.logRotationSizeMiB = 64;
    await invoke('save_settings', { payload: { settings: settings.value } });
  });
  const browser = app.context.browser();
  assert.ok(browser);
  const system = await browser.newBrowserCDPSession();
  try {
    for (const kind of ['code', 'text'])
      for (const shape of ['multiline', 'long-line']) {
        await check(kind + ' retained text and save scope: ' + shape, async () => {
          const count = kind === 'code' ? options.count : 1,
            bytes = 10485760,
            files = [];
          const line = 'class Sample { int value = 1; }\n';
          for (let index = 0; index < count; index++) {
            const path = join(fixture.mod, 'Memory-' + shape + '-' + index + '.txt');
            await writeFile(
              path,
              String(index).padStart(3, '0') +
                (shape === 'multiline' ? line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes - 4) : 'x'.repeat(bytes - 4)) +
                '\n',
              'utf8',
            );
            files.push({ path });
          }
          const opening = app.main.evaluate(
            async ({ kind, files, manifest }) => {
              const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke;
              if (kind === 'code') return invoke('open_code_editor', { key: crypto.randomUUID(), input: { ...manifest, files } });
              return invoke('request_window', {
                payload: {
                  identity: { type: 'text-editor', ...manifest, path: files[0]?.path },
                  title: '文本编辑器',
                  input: {
                    kind: 'text-editor',
                    location: { line: null, column: null, message: null, contextLabel: null, contextSeverity: null },
                  },
                  width: 1040,
                  height: 760,
                  minWidth: 780,
                  minHeight: 520,
                },
              });
            },
            { kind, files, manifest },
          );
          await until(async () => {
            for (const page of app.context.pages())
              if (page !== app.main && (await page.locator(kind === 'code' ? '.code-editor' : '.text-editor-page').count())) return true;
            return false;
          }, 'measurement editor ready');
          const found = (
            await Promise.all(
              app.context
                .pages()
                .filter((page) => page !== app.main)
                .map(async (page) => ({ page, match: await page.locator(kind === 'code' ? '.code-editor' : '.text-editor-page').count() })),
            )
          ).find((entry) => entry.match);
          assert.ok(found);
          const editor = found.page;
          await opening;
          const session = await app.context.newCDPSession(editor),
            samples = [],
            phases = /** @type {Record<string,unknown>[]} */ ([]);
          const surface = editor.getByRole('textbox', { name: '文件内容' });
          const run = createTestRun({
            scenario: kind + '-editor',
            parameters: { fileCount: count, fileBytes: bytes, textShape: shape },
            units: { fileCount: 'files', fileBytes: 'bytes' },
            execution: 'native',
            completion: '真实按键提交；磁盘内容相等并接纳保存回执',
            environment: app.environment,
            warmup: options.warmup,
            rounds: options.rounds,
            samples: [],
            budgets: [],
            resources: { released: false, heapPhases: phases },
          });
          runs.push(run);
          /** @param {string} phase */
          async function memory(phase) {
            await session.send('HeapProfiler.collectGarbage');
            const heap = await session.send('Runtime.getHeapUsage');
            const ids = (await system.send('SystemInfo.getProcessInfo')).processInfo
              .filter((item) => item.type === 'renderer')
              .map((item) => item.id);
            const processes = JSON.parse(
              execFileSync(
                'pwsh',
                [
                  '-NoProfile',
                  '-Command',
                  'Get-Process -Id ' + ids.join(',') + ' | Select-Object Id,PrivateMemorySize64,WorkingSet64 | ConvertTo-Json -Compress',
                ],
                { encoding: 'utf8', windowsHide: true },
              ),
            );
            phases.push({ phase, heap, processes });
          }
          try {
            await surface.waitFor();
            await memory('opened');
            const log = /** @type {{path:string}} */ (
              await app.main.evaluate(() => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('get_app_log_status'))
            );
            const before = (await readFile(log.path, 'utf8')).length;
            for (let index = 0; index < options.rounds + options.warmup; index++) {
              const began = performance.now();
              await surface.press('Control+Home');
              await surface.pressSequentially('!');
              const input = performance.now() - began,
                saveBegan = performance.now();
              await editor.getByRole('button', { name: '保存', exact: true }).click();
              await editor.locator('footer,.text-editor-status').filter({ hasText: '已保存' }).waitFor();
              const save = performance.now() - saveBegan;
              samples.push({ index, phase: index < options.warmup ? 'warmup' : 'measurement', input, save });
              run.samples.push({
                iteration: index,
                phase: index < options.warmup ? 'warmup' : 'measurement',
                metrics: { input, save },
                assertions: [],
              });
            }
            const savedFile = files[count - 1];
            assert.ok(savedFile);
            assert.ok((await readFile(savedFile.path, 'utf8')).startsWith('!'.repeat(options.rounds + options.warmup)));
            await memory('saved');
            for (let round = 0; round < 3; round++) {
              for (let index = 0; index < options.rounds; index++) await surface.press('Control+z');
              await memory('undo-' + round);
              for (let index = 0; index < options.rounds; index++) await surface.press('Control+y');
              await memory('redo-' + round);
            }
            let content = '';
            await until(async () => {
              content = (await readFile(log.path, 'utf8')).slice(before);
              return (
                content
                  .split('\n')
                  .filter((line) => line.includes('[command.completed]') && line.includes('request.action.kind=save_text_file')).length ===
                options.rounds + options.warmup
              );
            }, 'all text save commands recorded');
            const saveCommands = options.rounds + options.warmup;
            const loads = content
              .split('\n')
              .filter(
                (line) => line.includes('[command.started]') && line.includes('command=load_text_file') && line.includes('Memory-'),
              ).length;
            assert.equal(loads, 0, 'saved text is delivered without rereading unaffected documents');
            run.resources.saveCommands = saveCommands;
            for (const sample of run.samples) {
              sample.metrics.reads = loads;
              sample.assertions.push({ name: '额外文本读取为零', pass: loads === 0, actual: loads, expected: 0 });
            }
          } finally {
            await session.detach();
          }
          await editor.getByTitle('关闭', { exact: true }).click();
          await until(() => editor.isClosed(), 'measurement window released');
          const owners = await app.main.evaluate(
            (targets) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('query_edit_target_owners', { targets }),
            files.map((file) => ({ ...manifest, path: file.path })),
          );
          assert.equal(owners.length, 0);
        });
      }
  } finally {
    await system.detach();
  }
  return {};
}
