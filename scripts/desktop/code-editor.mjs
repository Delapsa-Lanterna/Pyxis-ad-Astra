import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { until } from './runtime.mjs';

/** @param {Awaited<ReturnType<typeof import('./runtime.mjs').startDesktop>>} app @param {Awaited<ReturnType<typeof import('./sample.mjs').prepareSample>>} fixture @param {(name:string, operation:()=>Promise<void>)=>Promise<void>} check @param {string} artifacts */
export async function codeEditor(app, fixture, check, artifacts) {
  const steps = /** @type {{name:string,pass:boolean}[]} */ ([]);
  await check('multi-file native editor lifecycle', async () => {
    const first = join(fixture.mod, 'First.java'),
      folder = join(fixture.mod, '目录 with spaces'),
      second = join(folder, 'Second.java');
    await mkdir(folder);
    const original = 'first\r\nsecond\nthird\rfinal';
    await writeFile(first, original, 'utf8');
    await writeFile(second, 'other file\n', 'utf8');
    await app.main.evaluate(async () => {
      const call = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke;
      const settings = await call('read_settings');
      settings.value.logLevel = 'debug';
      await call('save_settings', { payload: { settings: settings.value } });
    });
    const manifest = /** @type {{sessionId:string,modRoot:string}} */ (
      await app.main.evaluate(
        (root) =>
          Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_project_session', {
            payload: { modRoot: root, starsectorRoot: null },
          }),
        fixture.mod,
      )
    );
    const input = { sessionId: manifest.sessionId, modRoot: manifest.modRoot, files: [{ path: first }, { path: second }] };
    const opened = app.main.evaluate(
      async ({ input }) => {
        const call = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke;
        const [first, second] = await Promise.all([
          call('open_code_editor', { key: 'desktop-first', input: { ...input, files: [input.files[0]] } }),
          call('open_code_editor', { key: 'desktop-second', input: { ...input, files: [input.files[1]] } }),
        ]);
        return [...first, ...second];
      },
      { input },
    );
    const instance = app;
    await until(async () => {
      for (const page of instance.context.pages()) if (await page.locator('.code-editor').count()) return true;
      return false;
    }, 'native code editor');
    const editor = instance.context.pages().find((page) => page !== instance.main);
    assert.ok(editor);
    const receipt = /** @type {{path:string,diagnostic:unknown}[]} */ (await opened);
    assert.equal(receipt.length, 2);
    assert.ok(receipt.every((entry) => entry.diagnostic === null));
    assert.equal(await editor.getByRole('tab').count(), 2);
    await app.main.evaluate(
      ({ input }) =>
        Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_code_editor', {
          key: 'desktop-repeat',
          input: { ...input, files: [input.files[0]] },
        }),
      { input },
    );
    assert.equal(app.context.pages().filter((page) => page === editor).length, 1);
    assert.equal(await editor.getByRole('tab').count(), 2);
    const text = editor.getByRole('textbox', { name: '文件内容' });
    await text.fill('first\n中文 second\nthird\nfinal');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await until(async () => (await readFile(first, 'utf8')) === original.replace('second', '中文 second'), 'exact submitted text');
    await editor.locator('footer').filter({ hasText: '已保存' }).waitFor();
    steps.push({ name: 'mixed newlines and UTF-8 saved', pass: true });
    const moved = join(fixture.mod, 'Moved.java'),
      intermediate = join(fixture.mod, 'Middle.java');
    await rename(first, intermediate);
    await rename(intermediate, moved);
    await until(async () => (await editor.getByRole('tab', { name: 'Moved.java', exact: true }).count()) > 0, 'renamed document');
    await writeFile(moved, 'external update\r\n', 'utf8');
    await editor.evaluate(
      ({ sessionId }) =>
        Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('save_project', {
          request: { id: crypto.randomUUID(), edits: [], action: { kind: 'refresh_project_sources', input: { sessionId, sources: [] } } },
        }),
      manifest,
    );
    await until(async () => (await text.inputValue()) === 'external update\n', 'external text loaded');
    steps.push({ name: 'external change and renamed identity', pass: true });
    await editor.getByRole('tab', { name: 'Second.java', exact: true }).click();
    const relocated = join(fixture.mod, 'archive');
    await rename(folder, relocated);
    await until(
      async () => String(await editor.locator('.code-editor-tools > span').getAttribute('title')).includes('archive'),
      'directory rename mapped to file',
    );
    await editor.getByRole('tab', { name: 'Moved.java', exact: true }).click();
    steps.push({ name: 'chained file and directory renames', pass: true });
    await text.fill('unsaved');
    await editor.getByRole('button', { name: '关闭 Moved.java', exact: true }).click();
    const dialog = editor.getByRole('dialog');
    await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await text.inputValue(), 'unsaved');
    await editor.screenshot({ path: join(artifacts, 'native-dirty.png') });
    await editor.getByRole('button', { name: '关闭 Moved.java', exact: true }).click();
    await dialog.getByRole('button', { name: '保存并关闭', exact: true }).click();
    await until(async () => (await editor.getByRole('tab').count()) === 1, 'saved tab close');
    assert.equal(await readFile(moved, 'utf8'), 'unsaved');
    await editor.getByRole('button', { name: '关闭 Second.java', exact: true }).click();
    await editor.getByRole('heading', { name: '代码编辑器', exact: true }).waitFor();
    await editor.evaluate(() => {
      void Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('request_close', { scope: { kind: 'window' } });
    });
    await until(() => editor.isClosed(), 'native editor destroyed');
    steps.push({ name: 'save/close/cancel and native destruction', pass: true });
  });
  return { steps };
}
