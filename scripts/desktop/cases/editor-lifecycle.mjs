import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { until } from '../runtime.mjs';

/** @param {import('playwright').Page} page */
const surface = (page) => page.getByRole('textbox', { name: '文件内容' });
/** @param {import('playwright').Page} page */
const text = async (page) => (await surface(page).locator('.cm-line').allTextContents()).join('\n');
/** @param {import('playwright').Page} page */
async function save(page) {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.text-editor-status, .code-editor-status').filter({ hasText: '已保存' }).waitFor();
}
/** @param {import('playwright').Page} page */
async function close(page) {
  await page.getByTitle('关闭', { exact: true }).click();
  const discard = page.getByRole('button', { name: '放弃修改并关闭', exact: true });
  await until(async () => {
    try {
      if (page.isClosed()) return true;
      if (await discard.count()) await discard.click();
      return page.isClosed();
    } catch (error) {
      if (page.isClosed()) return true;
      throw error;
    }
  }, 'editor window released');
}
/** @param {import('playwright').Page} page @param {string} candidate */
async function compose(page, candidate) {
  await surface(page).press('Control+End');
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: candidate, selectionStart: candidate.length, selectionEnd: candidate.length });
  return session;
}

/** @param {Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>} app @param {Awaited<ReturnType<typeof import('../sample.mjs').prepareSample>>} fixture @param {(name:string, operation:()=>Promise<void>)=>Promise<void>} check */
async function crossEditorLifecycle(app, fixture, check) {
  const manifest = /** @type {{sessionId:string,modRoot:string}} */ (
    await app.main.evaluate(
      (root) =>
        Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_project_session', { payload: { modRoot: root, starsectorRoot: null } }),
      fixture.mod,
    )
  );
  const results = /** @type {Record<string,unknown>[]} */ ([]);
  /** @param {string} kind @param {string[]} paths @param {boolean} [recovery] */
  async function open(kind, paths, recovery = false) {
    const receipt = app.main.evaluate(
      async ({ kind, paths, manifest, recovery }) => {
        const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke;
        try {
          if (kind === 'code')
            return await invoke('open_code_editor', {
              key: crypto.randomUUID(),
              input: { ...manifest, files: paths.map((path) => ({ path })) },
            });
          return await invoke('request_window', {
            payload: {
              identity: recovery
                ? { type: 'recovery', modRoot: manifest.modRoot, path: paths[0] }
                : { type: 'text-editor', ...manifest, path: paths[0] },
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
        } catch (error) {
          return { diagnostic: error };
        }
      },
      { kind, paths, manifest, recovery },
    );
    await until(async () => {
      for (const page of app.context.pages())
        if (page !== app.main && (await page.locator(kind === 'code' ? '.code-editor' : '.text-editor-page').count())) return true;
      return false;
    }, 'editor content ready');
    const page =
      app.context
        .pages()
        .find((page) => page !== app.main && page.url().includes('kind=' + (kind === 'code' ? 'code-editor' : 'text-editor'))) ??
      (
        await Promise.all(
          app.context
            .pages()
            .filter((page) => page !== app.main)
            .map(async (page) => ({ page, match: await page.locator(kind === 'code' ? '.code-editor' : '.text-editor-page').count() })),
        )
      ).find((entry) => entry.match)?.page;
    assert.ok(page);
    await receipt;
    await surface(page).waitFor();
    return page;
  }
  for (const kind of ['text', 'code']) {
    await check(kind + ' Java highlighting, fold, current-file replace and saved bytes', async () => {
      const path = join(fixture.mod, 'Language-' + kind + '.java');
      const source = 'class Sample {\r\n\tvoid run() {\r\n\t\tint value = 1;\r\n\t}\r\n}';
      await writeFile(path, source, 'utf8');
      const page = await open(kind, [path]),
        input = surface(page);
      await page.locator('.text-token-keyword').first().waitFor();
      await input.press('Control+Home');
      await input.press('ArrowDown');
      await input.press('End');
      await input.press('Enter');
      assert.equal((await input.locator('.cm-line').allTextContents())[2], '\t\t');
      await input.press('Control+z');
      await page.getByTitle('折叠代码', { exact: true }).last().click();
      await page.locator('.cm-foldPlaceholder').click();
      await input.press('Control+h');
      const find = page.getByRole('textbox', { name: '查找', exact: true });
      await find.fill('value');
      await find.press('Enter');
      await page.getByRole('textbox', { name: '替换', exact: true }).fill('count');
      await page.getByRole('button', { name: '替换全部', exact: true }).click();
      await find.press('Escape');
      if (kind === 'code') {
        assert.equal(await page.getByRole('tab').last().getAttribute('aria-description'), '有未保存修改');
        await page.getByRole('button', { name: '打开代码总览', exact: true }).click();
        const overview = page.getByRole('region', { name: '代码总览', exact: true });
        await overview.waitFor();
        assert.equal(await overview.locator('dl > div').filter({ hasText: '未保存文件' }).locator('dd').innerText(), '1');
        await page.getByRole('tab').last().click();
        assert.equal(await text(page), source.replaceAll('\r\n', '\n').replace('value', 'count'));
      }
      await save(page);
      if (kind === 'code') assert.equal(await page.getByRole('tab').last().getAttribute('aria-description'), '已保存');
      assert.equal(await readFile(path, 'utf8'), source.replace('value', 'count'));
      await input.press('Control+z');
      await save(page);
      assert.equal(await readFile(path, 'utf8'), source);
      await close(page);
    });
    const path = join(fixture.mod, 'Composition-' + kind + '.txt');
    await writeFile(path, 'sample\r\n', 'utf8');
    const page = await open(kind, [path]);
    await check(kind + ' composition save boundary, close cancellation and external load', async () => {
      let session = await compose(page, '中');
      try {
        await surface(page).press('Control+s');
        assert.equal(await readFile(path, 'utf8'), 'sample\r\n');
        await session.send('Input.insertText', { text: '中文' });
      } finally {
        await session.detach();
      }
      assert.equal(await text(page), 'sample\n中文');
      await until(async () => (await readFile(path, 'utf8')) === 'sample\r\n中文', 'committed composition saved');
      await surface(page).pressSequentially('next');
      await surface(page).press('Control+z');
      assert.equal(await text(page), 'sample\n中文');
      assert.equal(await readFile(path, 'utf8'), 'sample\r\n中文');
      session = await compose(page, '候选');
      try {
        await page.getByTitle('关闭', { exact: true }).click();
        await page.getByRole('button', { name: '继续编辑', exact: true }).click();
        assert.equal(await text(page), 'sample\n中文候选');
      } finally {
        await session.detach();
      }
      session = await compose(page, '输入');
      try {
        await writeFile(path, 'external\r\n', 'utf8');
        await page.getByRole('button', { name: '载入外部文本', exact: true }).waitFor();
        assert.equal(await text(page), 'sample\n中文候选输入');
        await session.send('Input.insertText', { text: '输入完成' });
      } finally {
        await session.detach();
      }
      await page.getByRole('button', { name: '载入外部文本', exact: true }).click();
      await page.getByRole('button', { name: '放弃修改并载入', exact: true }).click();
      await until(async () => (await text(page)) === 'external\n', 'external text accepted');
      await surface(page).press('Control+z');
      assert.equal(await text(page), 'external\n');
      results.push({ kind, disk: await readFile(path, 'utf8'), externalHistoryCleared: true });
    });
    await close(page);
  }
  const first = join(fixture.mod, 'Shared.txt'),
    second = join(fixture.mod, 'Neighbour.txt');
  await writeFile(first, 'shared\r\n', 'utf8');
  await writeFile(second, 'neighbour\r\n', 'utf8');
  const plain = await open('text', [first]),
    code = await open('code', [first, second]);
  await check('composition tab switch and shared native editor ownership', async () => {
    await code.getByRole('tab').filter({ hasText: 'Shared.txt' }).click();
    const session = await compose(code, '候选');
    try {
      await code.getByRole('tab').filter({ hasText: 'Neighbour.txt' }).click();
    } finally {
      await session.detach();
    }
    assert.equal(await text(code), 'neighbour\n');
    await code.getByRole('tab').filter({ hasText: 'Shared.txt' }).click();
    assert.equal(await text(code), 'shared\n候选');
    await save(code);
    await until(async () => (await text(plain)) === 'shared\n候选', 'peer save accepted');
    const owners = await app.main.evaluate(
      (target) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('query_edit_target_owners', { targets: [target] }),
      { ...manifest, path: first },
    );
    assert.equal(owners.length, 2);
    await surface(plain).fill('plain draft');
    const conflict = /** @type {{code:string}} */ (
      await code.evaluate(
        async (identity) => {
          try {
            await Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('reserve_window_targets', { identities: [identity] });
            return null;
          } catch (error) {
            return error;
          }
        },
        { type: 'text-editor', ...manifest, path: first },
      )
    );
    assert.equal(conflict.code, 'window.target_unsaved');
    await save(plain);
    await until(async () => (await text(code)) === 'plain draft', 'text editor save accepted by code editor');
    results.push({ owners: owners.length, conflict: conflict.code, disk: await readFile(first, 'utf8') });
  });
  await close(plain);
  await check('pending composition save and chained rename retain the draft for an explicit retry', async () => {
    await surface(code).fill('captured');
    const session = await compose(code, '候选');
    const decisions = /** @type {string[]} */ ([]);
    try {
      await surface(code).press('Control+s');
      await code.locator('footer').filter({ hasText: '保存中' }).waitFor();
      const middle = join(fixture.mod, 'Middle-shared.txt'),
        moved = join(fixture.mod, 'Moved-shared.txt');
      await rename(first, middle);
      await rename(middle, moved);
      await code.getByRole('button', { name: '返回编辑', exact: true }).press('Enter');
      decisions.push('cancel old save');
      await code.getByRole('button', { name: '保留文本并跟随', exact: true }).press('Enter');
      decisions.push('follow');
      await until(async () => {
        return (
          String(await code.locator('.code-editor-path').getAttribute('title')).endsWith('Moved-shared.txt') &&
          String(await code.locator('footer').textContent()).includes('未保存')
        );
      }, 'save and identity handoff settled');
      assert.ok(decisions.includes('follow'));
      assert.equal(await text(code), 'captured候选');
      assert.equal(await readFile(moved, 'utf8'), 'plain draft');
      await assert.rejects(readFile(first), { code: 'ENOENT' });
      await surface(code).fill('later draft');
      await save(code);
      assert.equal(await readFile(moved, 'utf8'), 'later draft');
      results.push({ moved: 'Moved-shared.txt', disk: 'later draft', decisions, retried: true });
    } finally {
      await session.detach();
    }
  });
  await close(code);
  for (const recovery of [false, true]) {
    const path = join(fixture.mod, recovery ? 'Legacy-recovery.txt' : 'Legacy-session.txt');
    const bytes = recovery ? Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a]) : Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0d, 0x0a]);
    await writeFile(path, bytes);
    const page = await open('text', [path], recovery);
    try {
      await check((recovery ? 'recovery' : 'session') + ' encoding conversion, edit history and disk save', async () => {
        await page.getByRole('button', { name: '转码为 UTF-8', exact: true }).first().click();
        const dialog = page.getByRole('dialog');
        if (recovery) {
          await dialog.getByLabel('文件原编码').click();
          await page.locator('.n-base-select-option').filter({ hasText: 'Windows-1252' }).click();
        }
        await dialog.getByRole('button', { name: '转换并写回', exact: true }).click();
        const expected = recovery ? 'café\r\n' : '中文\r\n';
        await until(async () => (await readFile(path, 'utf8')) === expected, 'actual bytes converted');
        if (recovery) await page.getByRole('button', { name: '重试', exact: true }).click();
        await until(async () => (await text(page)) === expected.replace('\r\n', '\n'), 'converted text opened');
        await dialog.waitFor({ state: 'hidden' });
        await page.locator('.text-editor-body[aria-busy="false"]').waitFor();
        await surface(page).click();
        await surface(page).press('Control+End');
        await surface(page).pressSequentially('edited');
        await surface(page).press('Control+z');
        assert.equal(await text(page), expected.replace('\r\n', '\n'));
        await surface(page).press('Control+y');
        await save(page);
        assert.equal(await readFile(path, 'utf8'), expected + 'edited');
        results.push({ recovery, encoding: recovery ? 'windows-1252' : 'gb18030', disk: expected + 'edited' });
      });
    } finally {
      const cancel = page.getByRole('button', { name: '返回', exact: true });
      if (await cancel.count()) await cancel.press('Enter');
      await close(page);
    }
  }
  const remaining = await app.main.evaluate(
    (target) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('query_edit_target_owners', { targets: [target] }),
    { ...manifest, path: first },
  );
  assert.equal(remaining.length, 0);
  return results;
}

/** @param {Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>} app @param {Awaited<ReturnType<typeof import('../sample.mjs').prepareSample>>} fixture @param {(name:string, operation:()=>Promise<void>)=>Promise<void>} check @param {string} artifacts */
export async function editorLifecycle(app, fixture, check, artifacts) {
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
    await text.press('Control+Home');
    await text.press('ArrowDown');
    await text.press('Home');
    await text.pressSequentially('中文 ');
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
    await until(async () => (await text.locator('.cm-line').allTextContents()).join('\n') === 'external update\n', 'external text loaded');
    steps.push({ name: 'external change and renamed identity', pass: true });
    await editor.getByRole('tab', { name: 'Second.java', exact: true }).click();
    const relocated = join(fixture.mod, 'archive');
    await rename(folder, relocated);
    await until(
      async () => String(await editor.locator('.code-editor-path').getAttribute('title')).includes('archive'),
      'directory rename mapped to file',
    );
    await editor.getByRole('tab', { name: 'Moved.java', exact: true }).click();
    steps.push({ name: 'chained file and directory renames', pass: true });
    await text.fill('unsaved');
    await editor.getByRole('button', { name: '关闭 Moved.java', exact: true }).click();
    const dialog = editor.getByRole('dialog');
    await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await text.innerText(), 'unsaved');
    await editor.screenshot({ path: join(artifacts, 'native-dirty.png') });
    await editor.getByRole('button', { name: '关闭 Moved.java', exact: true }).click();
    await dialog.getByRole('button', { name: '保存并关闭', exact: true }).click();
    await until(async () => (await editor.getByRole('tab').count()) === 1, 'saved tab close');
    assert.equal(await readFile(moved, 'utf8'), 'unsaved');
    await editor.getByRole('button', { name: '关闭 Second.java', exact: true }).click();
    await editor.getByRole('heading', { name: '代码总览', exact: true }).waitFor();
    await editor.evaluate(() => {
      void Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('request_close', { scope: { kind: 'window' } });
    });
    await until(() => editor.isClosed(), 'native editor destroyed');
    steps.push({ name: 'save/close/cancel and native destruction', pass: true });
  });
  return { steps, lifecycle: await crossEditorLifecycle(app, fixture, check) };
}
