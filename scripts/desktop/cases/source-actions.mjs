import assert from 'node:assert/strict';
import { writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { javaQueries } from './java-queries.mjs';
import { until } from '../runtime.mjs';

/** @param {string} log @param {import('./registry.mjs').DesktopCase['check']} check */
export async function verifyJavaLogs(log, check) {
  await check('Java lifecycle, detailed requests and failure levels reach the application log', async () => {
    assert.match(log, /\[debug\] \[java_analysis.request\].*queueWaitMilliseconds.*requestMilliseconds.*responseBytes/);
    const opened = log.split('\n').find((line) => line.includes('[info] [java_analysis.project_opened]'));
    assert.ok(opened?.includes('modRoot') && opened.includes('sessionId'));
    assert.match(log, /\[warning\] \[java_analysis.request\].*engine\.stale_project/);
    assert.match(log, /\[error\] \[java_analysis.management\].*missing-java/);
    assert.match(log, /java_analysis.project_closed/);
    assert.ok(!log.includes('class Consumer {Object call()'));
  });
}

/** @param {import('./registry.mjs').DesktopCase} context */
export async function sourceActions(context) {
  return javaQueries(context, async ({ app, page, file, manifest }) => {
    await app.main.evaluate(async () => {
      const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke;
      const settings = await invoke('read_settings');
      await invoke('save_settings', { payload: { settings: { ...settings.value, logLevel: 'debug' } } });
    });
    await context.check('Java diagnostics preserve rejected revisions and failed operation causes', async () => {
      const rejected = await page.evaluate(async (file) => {
        try {
          await Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('java_editor', {
            action: { kind: 'assist', purpose: 'validate', revision: 1, file, offset: 0, choices: {} },
          });
          return null;
        } catch (error) {
          return error;
        }
      }, file);
      assert.match(JSON.stringify(rejected), /engine.stale_project/);
      const failed = await app.main.evaluate(
        async (javaPath) =>
          Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('manage_java_analysis', {
            action: { kind: 'probe', javaPath },
            operationKey: crypto.randomUUID(),
          }),
        join(manifest.modRoot, 'missing-java.exe'),
      );
      assert.equal(failed.phase, 'failed');
      assert.ok(failed.error.includes('missing-java.exe'));
    });
    const second = join(manifest.modRoot, 'src/Consumer.java'),
      original = await readFile(file, 'utf8');
    const caller = 'class Consumer {Object call(){return new Orbit().run();}}';
    await writeFile(second, caller);
    await app.main.evaluate(
      (input) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_code_editor', { input, key: crypto.randomUUID() }),
      { ...manifest, files: [{ path: second }, { path: file }] },
    );
    const surface = page.getByRole('textbox', { name: '文件内容' });
    const reset = async () => {
      await page.getByRole('button', { name: '关闭 Orbit.java', exact: true }).click();
      await page.getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
      await app.main.evaluate(
        (input) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_code_editor', { input, key: crypto.randomUUID() }),
        { ...manifest, files: [{ path: file }] },
      );
      await until(
        async () => (await surface.locator('.cm-line').allTextContents()).join('\n') === original.replace(/\r\n?/g, '\n'),
        'reopened file view',
      );
    };
    /** @param {string} value */
    const select = async (value) => {
      await surface.press('Control+f');
      const input = page.getByRole('textbox', { name: '查找', exact: true });
      await input.fill(value);
      await input.press('Enter');
      await input.press('Escape');
      const source = (await surface.locator('.cm-line').allTextContents()).join('\n');
      const before = source.slice(0, source.indexOf(value)).split('\n');
      await surface.press('Control+Home');
      for (let line = 1; line < before.length; line++) await surface.press('ArrowDown');
      await surface.press('Home');
      for (let column = 0; column < Array.from(before.at(-1) ?? '').length; column++) await surface.press('ArrowRight');
      await page.evaluate(
        () => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))),
      );
      const point = await page.evaluate((token) => {
        const { document, NodeFilter } = globalThis;
        const root = /** @type {HTMLElement} */ (document.querySelector('.cm-content'));
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const index = (node.textContent ?? '').indexOf(token);
          if (index < 0) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + token.length);
          const rect = range.getBoundingClientRect();
          return { x: rect.x + Math.min(rect.width / 2, 8), y: rect.y + rect.height / 2 };
        }
        throw Error('Expected source token: ' + token);
      }, value);
      return point;
    };
    const save = async () => {
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await until(async () => {
        const errors = await page.locator('[role=dialog], .n-message-container, .n-notification-container').allTextContents();
        if (errors.some((text) => text.includes('失败'))) throw Error(errors.join('\n'));
        return (await page.locator('footer').innerText()).includes('已保存');
      }, 'grouped save receipt');
    };
    /** @param {string} token @param {string} name */
    const rename = async (token, name) => {
      const point = await select(token);
      const selected = await page.locator('footer').innerText();
      await page.getByRole('button', { name: 'Java 操作', exact: true }).click();
      await page.getByRole('textbox', { name: '重命名的新名称' }).fill(name);
      const prepared = await page.locator('footer').innerText();
      await page.getByRole('button', { name: '预览重命名', exact: true }).click();
      await until(async () => {
        const notices = await page.locator('[role=dialog], .n-message-container, .n-notification-container').allTextContents();
        if (notices.some((text) => text.includes('失败'))) {
          await page.screenshot({ path: join(context.artifacts, 'rename-failed.png') });
          throw Error(JSON.stringify({ token, point, selected, prepared, current: await page.locator('footer').innerText(), notices }));
        }
        return page.getByRole('region', { name: '修改预览' }).isVisible();
      }, 'rename preview');
      await page.getByRole('button', { name: '接纳整批修改', exact: true }).click();
      await page.screenshot({ path: join(context.artifacts, 'accepted-' + name + '.png') });
      const errors = await page.locator('[role=dialog], .n-message-container, .n-notification-container').allTextContents();
      if (errors.some((text) => text.includes('失败') || text.includes('变化'))) throw Error(errors.join('\n'));
    };
    await context.check('native CodeMirror context clipboard edits preserve undo and the source file', async () => {
      await surface.fill('class Orbit {}');
      await surface.press('Control+Home');
      await surface.press('Shift+End');
      await surface
        .locator('.cm-line')
        .first()
        .click({ button: 'right', position: { x: 20, y: 8 } });
      await page.getByText('复制', { exact: true }).click();
      await surface.press('End');
      await surface.press('Enter');
      await surface
        .locator('.cm-line')
        .last()
        .click({ button: 'right', position: { x: 20, y: 8 } });
      await page.getByText('粘贴', { exact: true }).click();
      assert.equal((await surface.locator('.cm-line').allTextContents()).join('\n'), 'class Orbit {}\nclass Orbit {}');
      await surface.press('Control+z');
      assert.equal((await surface.locator('.cm-line').allTextContents()).join('\n'), 'class Orbit {}\n');
      assert.equal(await readFile(file, 'utf8'), original);
      await reset();
    });
    await context.check('native completion and parameter hints use the current draft', async () => {
      await surface.fill('class Orbit {String run(){return Library.val;}}');
      const point = await select('val');
      await page.mouse.dblclick(point.x, point.y);
      await surface.press('ArrowRight');
      await surface.press('Control+Space');
      await page.getByRole('option').filter({ hasText: 'value' }).first().click();
      await until(async () => (await surface.innerText()).includes('Library.value()'), 'completion inserted');
      await select('value');
      await page.getByRole('button', { name: 'Java 操作', exact: true }).click();
      await page.getByRole('button', { name: '参数提示', exact: true }).click();
      await page.locator('.code-signature').waitFor();
      assert.match(await page.locator('.code-signature').innerText(), /value/);
      await reset();
    });
    await context.check('native import choices produce versioned draft edits', async () => {
      await surface.fill('import java.util.Set;\r\nclass Orbit {List<String> values; Object run(){return Library.value();}}\r\n');
      await page.getByRole('button', { name: 'Java 操作', exact: true }).click();
      await page.getByRole('button', { name: '整理导入', exact: true }).click();
      await page.locator('.code-analysis-results .n-select').click();
      await page.getByText('java.util.List', { exact: true }).click();
      await page.getByRole('button', { name: '接纳导入选择', exact: true }).click();
      await page.getByRole('button', { name: '接纳整批修改', exact: true }).click();
      await until(async () => (await surface.innerText()).includes('import java.util.List;'), 'import draft accepted');
      assert.equal(await readFile(file, 'utf8'), original);
      await reset();
    });
    await context.check('native grouped method edits, save and undo preserve both files', async () => {
      await rename('run', 'measure');
      await until(async () => (await surface.innerText()).includes('measure'), 'renamed method draft');
      assert.equal(await readFile(file, 'utf8'), original);
      assert.equal(await readFile(second, 'utf8'), caller);
      await save();
      await until(async () => (await readFile(second, 'utf8')).includes('.measure()'), 'both method files committed');
      await surface.press('Control+z');
      await until(async () => (await surface.innerText()).includes('run()'), 'whole draft undo');
      await save();
      assert.equal(await readFile(file, 'utf8'), original);
      assert.equal(await readFile(second, 'utf8'), caller);
    });
    await context.check('native public type rename moves the file and grouped undo restores its identity', async () => {
      await page.getByRole('tab').filter({ hasText: 'Orbit.java' }).click();
      await rename('Orbit', 'Beacon');
      await page.getByRole('tab').filter({ hasText: 'Beacon.java' }).waitFor();
      const target = join(manifest.modRoot, 'src/Beacon.java');
      await assert.rejects(stat(target));
      await save();
      await until(async () => {
        try {
          return (await readFile(target, 'utf8')).includes('class Beacon');
        } catch (error) {
          if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false;
          throw error;
        }
      }, 'type move committed');
      assert.match(await readFile(second, 'utf8'), /new Beacon/);
      await surface.press('Control+z');
      await save();
      await until(async () => {
        try {
          return (await readFile(file, 'utf8')) === original;
        } catch (error) {
          if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false;
          throw error;
        }
      }, 'type identity restored');
      assert.equal(await readFile(second, 'utf8'), caller);
      await page.screenshot({ path: join(context.artifacts, 'source-actions-native.png') });
    });
    return { groupedFiles: 2, sourcePreservedUntilSave: true, typeIdentityUndo: true };
  });
}
