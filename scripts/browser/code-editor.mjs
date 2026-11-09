import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rotation, summarize, compare } from '../shared/sample-statistics.mjs';

/** @param {import('playwright').Page} page */
async function openSample(page) {
  await page.getByText('打开子窗口', { exact: true }).click();
  await page.getByRole('button', { name: '代码编辑器', exact: true }).click();
  await page.getByText('打开子窗口', { exact: true }).click();
  const label = await page.evaluate(() => {
    const workspace = Reflect.get(globalThis, 'browserWorkspace');
    return [...workspace.windows].find(([, entry]) => entry.context?.kind === 'code-editor')[0];
  });
  const editor = page.frameLocator('iframe[data-window="' + label + '"]');
  await editor.getByRole('textbox', { name: '文件内容' }).waitFor();
  return editor;
}

/** @param {import('playwright').FrameLocator} editor */
async function closeDocuments(editor) {
  const buttons = editor.getByRole('button', { name: /^关闭 / });
  while (await buttons.count()) await buttons.first().click();
  assert.equal(await editor.getByRole('tab').count(), 0);
}

/** @param {import('playwright').Page} page @param {string} output */
export async function verifyCodeEditor(page, output) {
  const editor = await openSample(page);
  assert.equal(await editor.getByRole('tab').count(), 3);
  const surface = editor.getByRole('textbox', { name: '文件内容' });
  await surface.fill('modified third\n');
  await editor.getByRole('tab').first().click();
  await surface.fill('modified first\n');
  await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').openSampleWindow('code-editor'));
  assert.equal(await editor.getByRole('tab').count(), 3);
  assert.equal(await surface.inputValue(), 'modified third\n');
  await editor.getByRole('button', { name: '保存全部', exact: true }).click();
  await editor.locator('footer').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').codeEditor.pending), 0);
  const checks = [{ name: 'open, reuse, independent drafts and save all', pass: true }];
  const beforeComposition = await surface.inputValue();
  await surface.focus();
  await surface.press('End');
  const inputSession = await page.context().newCDPSession(page);
  try {
    await inputSession.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
    await inputSession.send('Input.insertText', { text: '中文' });
  } finally {
    await inputSession.detach();
  }
  assert.equal(await surface.inputValue(), beforeComposition + '中文');
  await surface.press('Control+z');
  assert.equal(await surface.inputValue(), beforeComposition);
  await surface.press('Control+y');
  assert.equal(await surface.inputValue(), beforeComposition + '中文');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.locator('footer').filter({ hasText: '已保存' }).waitFor();
  checks.push({ name: 'native IME commits one undo step and redo restores it', pass: true });
  const originalOrder = await editor.getByRole('tab').allTextContents();
  await editor.getByRole('tab').first().dragTo(editor.getByRole('tab').last());
  assert.notDeepEqual(await editor.getByRole('tab').allTextContents(), originalOrder);
  checks.push({ name: 'tab drag preserves native text view', pass: true });
  for (const width of [1280, 800])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => Reflect.get(globalThis, 'browserWorkspace').setAppearance({ theme }), theme);
      await editor.locator('.code-editor').screenshot({ path: join(output, 'code-editor-' + theme + '-' + width + '.png') });
      checks.push({ name: theme + '-' + width, pass: true });
    }
  await closeDocuments(editor);
  checks.push({ name: 'all documents released', pass: true });
  return checks;
}

/** @typedef {{page:import('playwright').Page,label:string,environment:Record<string,unknown>}} MeasurementEntry */
/** @typedef {{iteration:number,phase:string,switch:number,input:number,save:number,ipc:number,reads:number}} EditorSample */
/** @typedef {MeasurementEntry & {editor:import('playwright').FrameLocator,openMilliseconds:number,samples:EditorSample[]}} MeasurementGroup */
/** @param {MeasurementEntry[]} entries @param {{warmup:number,rounds:number,count?:number,shape?:string}} options */
export async function measureCodeEditor(entries, options) {
  if (options.shape && !['multiline', 'long-line'].includes(options.shape)) throw Error('Unknown text shape: ' + options.shape);
  const runs = [],
    order = [],
    comparisons = [];
  for (const count of options.count ? [options.count] : [1, 10, 50])
    for (const bytes of [102400, 1048576, 10485760])
      for (const shape of options.shape ? [options.shape] : ['multiline', 'long-line']) {
        const groups = /** @type {MeasurementGroup[]} */ ([]);
        try {
          for (const entry of entries) {
            const { page } = entry;
            await page.reload();
            await page.locator('.browser-workspace-shell').waitFor();
            const editor = await openSample(page);
            await closeDocuments(editor);
            const began = performance.now();
            await page.evaluate(
              async ({ count, bytes, shape }) => {
                const workspace = Reflect.get(globalThis, 'browserWorkspace');
                const project = workspace.projects.find((/** @type {{manifest:{modRoot:string}}} */ project) =>
                  project.manifest.modRoot.endsWith('/code_sample'),
                );
                const files = Array.from({ length: count }, (_, index) => ({
                  path: project.manifest.modRoot + '/benchmark/' + count + '-' + bytes + '-' + index + '.java',
                }));
                const line = 'class Sample { int value = 1; }\n';
                for (const [index, file] of files.entries())
                  project.textFiles.set(
                    file.path,
                    String(index).padStart(3, '0') +
                      (shape === 'long-line' ? 'x'.repeat(bytes - 4) : line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes - 4)) +
                      '\n',
                  );
                await workspace.invoke('main', 'open_code_editor', {
                  key: crypto.randomUUID(),
                  input: { sessionId: project.manifest.sessionId, modRoot: project.manifest.modRoot, files },
                });
              },
              { count, bytes, shape },
            );
            assert.equal(await editor.getByRole('tab').count(), count);
            groups.push({
              ...entry,
              editor,
              openMilliseconds: performance.now() - began,
              samples: /** @type {{iteration:number,phase:string,switch:number,input:number,save:number,ipc:number,reads:number}[]} */ ([]),
            });
          }
          for (let iteration = 0; iteration < options.warmup + options.rounds; iteration++) {
            const phase = iteration < options.warmup ? 'warmup' : 'measurement';
            for (const index of rotation(groups.length, iteration)) {
              const group = groups[index];
              assert.ok(group);
              const { page, editor } = group;
              await page.bringToFront();
              await page.evaluate(async () => {
                const workspace = Reflect.get(globalThis, 'browserWorkspace');
                for (const label of workspace.windows.keys()) await workspace.emit('browser-measurement-ready', null, label);
              });
              const before = await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').calls.length);
              const began = performance.now();
              await editor
                .getByRole('tab')
                .nth(iteration % count)
                .click();
              const switched = performance.now();
              const calls = /** @type {{command:string}[]} */ (
                await page.evaluate((before) => Reflect.get(globalThis, 'browserWorkspace').calls.slice(before), before)
              );
              assert.equal(calls.length, 0, 'loaded tab switches perform no IPC or file read: ' + JSON.stringify(calls));
              const surface = editor.getByRole('textbox', { name: '文件内容' });
              const inputBegan = performance.now();
              await surface.press('End');
              await surface.pressSequentially('!');
              const input = performance.now() - inputBegan;
              const saveBegan = performance.now();
              await editor.getByRole('button', { name: '保存', exact: true }).click();
              await editor.locator('footer').filter({ hasText: '已保存' }).waitFor();
              group.samples.push({
                iteration,
                phase,
                switch: switched - began,
                input,
                save: performance.now() - saveBegan,
                ipc: calls.length,
                reads: calls.filter((call) => call.command === 'query_file_text_target').length,
              });
              order.push({ count, bytes, shape, iteration, phase, variant: group.label });
              await page.evaluate(() => {
                const project = Reflect.get(globalThis, 'browserWorkspace').projects.find(
                  (/** @type {{manifest:{modRoot:string}}} */ project) => project.manifest.modRoot.endsWith('/code_sample'),
                );
                project.snapshots.length = 0;
                project.redos.length = 0;
                project.history.undoStack.length = 0;
                project.history.redoStack.length = 0;
              });
            }
          }
          for (const group of groups) {
            const cdp = await group.page.context().newCDPSession(group.page);
            try {
              const memory = await cdp.send('Runtime.getHeapUsage');
              const began = performance.now();
              await closeDocuments(group.editor);
              const closeMilliseconds = performance.now() - began;
              const reopen = performance.now();
              await group.page.evaluate(
                async ({ count, bytes }) => {
                  const workspace = Reflect.get(globalThis, 'browserWorkspace');
                  const project = workspace.projects.find((/** @type {{manifest:{modRoot:string}}} */ project) =>
                    project.manifest.modRoot.endsWith('/code_sample'),
                  );
                  await workspace.invoke('main', 'open_code_editor', {
                    key: crypto.randomUUID(),
                    input: {
                      sessionId: project.manifest.sessionId,
                      modRoot: project.manifest.modRoot,
                      files: Array.from({ length: count }, (_, index) => ({
                        path: project.manifest.modRoot + '/benchmark/' + count + '-' + bytes + '-' + index + '.java',
                      })),
                    },
                  });
                },
                { count, bytes },
              );
              const reopenMilliseconds = performance.now() - reopen;
              const windowClose = performance.now();
              await group.editor.getByTitle('关闭', { exact: true }).click();
              await group.editor.owner().waitFor({ state: 'detached' });
              assert.equal(await group.editor.owner().count(), 0);
              assert.equal(await group.page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').codeEditor.pending), 0);
              const windowCloseMilliseconds = performance.now() - windowClose;
              await group.page.evaluate(
                ({ count, bytes }) => {
                  const project = Reflect.get(globalThis, 'browserWorkspace').projects.find(
                    (/** @type {{manifest:{modRoot:string}}} */ project) => project.manifest.modRoot.endsWith('/code_sample'),
                  );
                  for (const path of [...project.textFiles.keys()])
                    if (path.includes('/benchmark/' + count + '-' + bytes + '-')) project.textFiles.delete(path);
                  project.snapshots.length = 0;
                  project.redos.length = 0;
                  project.history.undoStack.length = 0;
                  project.history.redoStack.length = 0;
                  project.write(null, { kind: 'text', path: project.manifest.modRoot + '/benchmark' }, [], true);
                },
                { count, bytes },
              );
              await cdp.send('HeapProfiler.collectGarbage');
              const releasedMemory = await cdp.send('Runtime.getHeapUsage');
              const measured = group.samples.filter((sample) => sample.phase === 'measurement');
              const metrics = Object.fromEntries(
                ['switch', 'input', 'save'].map((metric) => [
                  metric,
                  summarize(measured.map((sample) => sample[/** @type {'switch'|'input'|'save'} */ (metric)])),
                ]),
              );
              runs.push({
                variant: group.label,
                count,
                bytes,
                shape,
                environment: group.environment,
                openMilliseconds: group.openMilliseconds,
                closeMilliseconds,
                reopenMilliseconds,
                windowCloseMilliseconds,
                samples: group.samples,
                metrics,
                memory,
                releasedMemory,
                remainingDocuments: 0,
              });
            } finally {
              await cdp.detach();
            }
          }
          const current = runs.slice(-groups.length);
          for (let index = 1; index < current.length; index++) {
            const before = current[0],
              after = current[index];
            assert.ok(before && after);
            comparisons.push({
              count,
              bytes,
              shape,
              before: before.variant,
              after: after.variant,
              values: compare(before.metrics, after.metrics),
            });
          }
          console.log(
            JSON.stringify({
              scene: 'code-editor',
              count,
              bytes,
              shape,
              rounds: options.rounds,
              variants: groups.map((group) => group.label),
            }),
          );
        } finally {
          for (const group of groups) if (await group.editor.locator('.code-editor').count()) await closeDocuments(group.editor);
        }
      }
  return { measurements: runs, order, comparisons };
}
