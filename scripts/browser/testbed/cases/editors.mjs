import assert from 'node:assert/strict';
import { createTestRun } from '../../../shared/test-report.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { textSample, editedText } from '../../../shared/performance-samples.mjs';

/** @param {import('../../runtime.mjs').BrowserEntry} entry @param {import('../../../../src/test/browser/contracts.js').RunOptions} options @param {import('../../../shared/test-report.mjs').TestRun[]} runs */
export async function* measureEditor(entry, options, runs) {
  const { page, environment } = entry;
  const samples = /** @type {import('../../../shared/test-report.mjs').TestSample[]} */ ([]);
  const run = createTestRun({
    scenario: options.scene,
    parameters: {
      fileCount: options.count,
      fileBytes: options.fileBytes ?? 102400,
      textShape: options.textShape ?? 'multiline',
      workload: options.workload,
    },
    units: { fileCount: 'files', fileBytes: 'bytes' },
    execution: 'keyboard',
    completion: '真实按键提交；当前样本保存回执接纳并显示已保存',
    environment,
    warmup: options.warmup,
    rounds: options.rounds,
    samples,
    resources: { released: false },
  });
  run.environment.variant = entry.environment.variant ?? 'current';
  runs.push(run);
  const opened = await page.evaluate((options) => Reflect.get(globalThis, 'testbed').openEditor(options), options);
  const editor = page.frameLocator('iframe[data-window="' + opened.label + '"]');
  const surface = editor.getByRole('textbox', { name: '文件内容' });
  const original = textSample(options.fileBytes ?? 102400, options.textShape ?? 'multiline', options.count - 1);
  const history = /** @type {Record<string,unknown>[]} */ ([]);
  run.resources.history = history;
  /** @param {number} steps */
  async function verifyText(steps) {
    const actual = await surface.evaluate(async (element) => {
      const text = Reflect.get(element, 'cmTile').root.view.state.doc.toString();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    });
    assert.equal(actual, createHash('sha256').update(editedText(original, steps)).digest('hex'), 'Complete editor text at step ' + steps);
  }
  /** @param {string} phase */
  async function memory(phase) {
    await cdp.send('HeapProfiler.collectGarbage');
    run.resources[phase] = await cdp.send('Runtime.getHeapUsage');
    await processes(phase + 'Renderers');
  }
  const cdp = await page.context().newCDPSession(page);
  const browser = page.context().browser();
  assert.ok(browser);
  const system = await browser.newBrowserCDPSession();
  /** @param {string} phase */
  async function processes(phase) {
    if (process.platform !== 'win32') return;
    const ids = (await system.send('SystemInfo.getProcessInfo')).processInfo
      .filter((item) => item.type === 'renderer')
      .map((item) => item.id);
    run.resources[phase] = JSON.parse(
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
  }
  try {
    await surface.waitFor();
    await memory('opened');
    for (let iteration = 0; iteration < options.warmup + options.rounds; iteration++) {
      await page.evaluate(async () => {
        const workspace = Reflect.get(globalThis, 'browserWorkspace');
        for (const label of workspace.windows.keys()) await workspace.emit('browser-measurement-ready', null, label);
      });
      const before = await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').calls.length);
      const switched = performance.now();
      if (options.scene !== 'text-editor')
        await editor
          .getByRole('tab')
          .nth(iteration % options.count)
          .click();
      const switchMilliseconds = performance.now() - switched;
      const calls = /** @type {{command:string}[]} */ (
        await page.evaluate((start) => Reflect.get(globalThis, 'browserWorkspace').calls.slice(start), before)
      );
      assert.equal(calls.length, 0, 'loaded document switches perform no IPC: ' + JSON.stringify(calls));
      if (options.scene !== 'text-editor') await editor.getByRole('tab').last().click();
      const input = performance.now();
      await surface.press(iteration % 2 ? 'Control+End' : 'Control+Home');
      await surface.pressSequentially('!');
      const inputMilliseconds = performance.now() - input;
      const saved = performance.now();
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await editor.locator('footer,.text-editor-status').filter({ hasText: '已保存' }).waitFor();
      const saveMilliseconds = performance.now() - saved;
      const saveReads = await page.evaluate(
        (start) =>
          Reflect.get(globalThis, 'browserWorkspace')
            .calls.slice(start)
            .filter((/** @type {{command:string}} */ call) => call.command === 'load_text_file').length,
        before,
      );
      samples.push({
        iteration,
        phase: iteration < options.warmup ? 'warmup' : 'measurement',
        metrics: {
          switch: switchMilliseconds,
          input: inputMilliseconds,
          save: saveMilliseconds,
          reads: 0,
          ipc: calls.length,
          saveReads,
          ...(options.scene === 'java-queries' ? await page.evaluate(() => Reflect.get(globalThis, 'testbed').queryEditor()) : {}),
        },
        assertions: [{ name: '保存接纳所属文本', actual: saveReads, expected: 0, pass: saveReads === 0 }],
      });
      assert.equal(saveReads, 0);
      await verifyText(iteration + 1);
      const savedText = await page.evaluate(
        async ({ file, expected }) => {
          const text = Reflect.get(globalThis, 'browserWorkspace').projects[1].textFiles.get(file);
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
          return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') === expected;
        },
        {
          file: opened.file,
          expected: createHash('sha256')
            .update(editedText(original, iteration + 1))
            .digest('hex'),
        },
      );
      assert.equal(savedText, true, 'Saved sample contains the complete submitted text');
      await page.evaluate(() => {
        const project = Reflect.get(globalThis, 'browserWorkspace').projects[1];
        project.snapshots.length = 0;
        project.redos.length = 0;
        project.history.undoStack.length = 0;
        project.history.redoStack.length = 0;
      });
      yield { iteration };
    }
    await memory('saved');
    for (let cycle = 0; cycle < 3; cycle++)
      for (const operation of ['undo', 'redo']) {
        for (let step = 0; step < options.rounds; step++) {
          const began = performance.now();
          await surface.press(operation === 'undo' ? 'Control+z' : 'Control+y');
          const milliseconds = performance.now() - began;
          const steps = operation === 'undo' ? options.warmup + options.rounds - step - 1 : options.warmup + step + 1;
          await verifyText(steps);
          history.push({ cycle, operation, step, milliseconds, characters: original.length + steps });
        }
        await memory(operation + '-' + cycle);
      }
    run.resources.heapBeforeCollection = await cdp.send('Runtime.getHeapUsage');
    await cdp.send('HeapProfiler.collectGarbage');
    run.resources.heapBeforeClose = await cdp.send('Runtime.getHeapUsage');
    await processes('rendererBeforeClose');
    const began = performance.now();
    if (options.scene !== 'text-editor') {
      const buttons = editor.getByRole('button', { name: /^关闭 / });
      while (await buttons.count()) await buttons.first().click();
      assert.equal(await editor.getByRole('tab').count(), 0);
    }
    run.resources.documentsCloseMilliseconds = performance.now() - began;
    run.resources.openMilliseconds = opened.openMilliseconds;
  } catch (error) {
    samples.push({
      iteration: samples.length,
      phase: 'failure',
      metrics: {},
      assertions: [],
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    try {
      const closed = performance.now();
      await page.evaluate(() => Reflect.get(globalThis, 'testbed').close());
      run.resources.windowCloseMilliseconds = performance.now() - closed;
      assert.equal(await page.locator('iframe[data-window]').count(), 0);
      await cdp.send('HeapProfiler.collectGarbage');
      run.resources.heapAfterClose = await cdp.send('Runtime.getHeapUsage');
      await page.waitForTimeout(500);
      await cdp.send('HeapProfiler.collectGarbage');
      run.resources.heapAfterIdle = await cdp.send('Runtime.getHeapUsage');
      await processes('rendererAfterClose');
      run.resources.released = true;
    } finally {
      await cdp.detach();
      await system.detach();
      Object.assign(run, createTestRun(run));
    }
  }
}
