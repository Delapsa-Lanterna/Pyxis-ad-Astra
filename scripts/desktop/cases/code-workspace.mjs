import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { until } from '../runtime.mjs';

/** @param {import('./registry.mjs').DesktopCase} context */
export async function codeWorkspace({ launch, fixture, options, check, artifacts }) {
  if (!options.game) throw Error('Code workspace requires --game for Java 17');
  await mkdir(join(fixture.mod, 'src'), { recursive: true });
  await writeFile(join(fixture.mod, 'src/Orbit.java'), 'class Orbit {int value(){return 1;}}');
  await writeFile(join(fixture.mod, 'Outside.java'), 'class Outside {}');
  const app = await launch(),
    main = app.main;
  await main.evaluate(
    async ({ game, mod }) => {
      const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke;
      const settings = await invoke('read_settings');
      await invoke('save_settings', { payload: { settings: { ...settings.value, starsectorRoot: game, javaExecutable: null } } });
      const manifest = await invoke('open_project_session', { payload: { modRoot: mod, starsectorRoot: game } });
      const stores = Reflect.get(/** @type {HTMLElement} */ (globalThis.document.querySelector('#app')), '__vue_app__').config
        .globalProperties.$pinia._s;
      stores.get('project').registerProjectManifest(manifest);
      stores.get('csv-editor').initializeModTables({ sessionId: manifest.sessionId, modRoot: manifest.modRoot, manifest });
      stores.get('workspace').registerMod({ modRoot: manifest.modRoot, displayName: 'Desktop sample', version: '1', status: 'ready' });
      stores.get('workspace').activateModTab(manifest.modRoot);
    },
    { game: options.game, mod: fixture.mod },
  );
  await main.getByRole('tab').filter({ hasText: 'Desktop sample' }).click();
  const entry = main.getByRole('button', { name: '代码编辑器', exact: true });
  const begun = performance.now();
  await entry.click();
  /** @type {import('playwright').Page | undefined} */
  let editor;
  await until(() => {
    editor = app.context.pages().find((page) => page !== main);
    return Boolean(editor);
  }, 'code workspace window');
  const page = editor;
  assert.ok(page);
  await page.getByText('选择文件开始编辑', { exact: true }).waitFor();
  const openMilliseconds = performance.now() - begun;
  const management = () =>
    main.evaluate(() =>
      Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('manage_java_analysis', {
        action: { kind: 'refresh' },
        operationKey: crypto.randomUUID(),
      }),
    );
  const tree = page.getByRole('complementary', { name: '项目文件' }),
    surface = page.getByRole('textbox', { name: '文件内容' });
  await check('formal navigation opens an empty window and ordinary text without Java', async () => {
    assert.equal((await management()).instances, 0);
    await tree.getByText('notes.txt', { exact: true }).dblclick();
    await surface.filter({ hasText: 'Initial text' }).waitFor();
    assert.equal((await management()).instances, 0);
    await surface.fill('Saved from project tree\r\n');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('footer').filter({ hasText: '已保存' }).waitFor();
    assert.equal(await readFile(fixture.notes, 'utf8'), 'Saved from project tree\n');
    await surface.fill('retained draft');
    await entry.click();
    assert.equal(app.context.pages().length, 2);
    assert.equal(await page.getByRole('tab').count(), 1);
    assert.match(await surface.innerText(), /retained draft/);
  });
  await check('outside sources keep text editing and source-root Java starts one shared JVM', async () => {
    await tree.getByText('Outside.java', { exact: true }).dblclick();
    await page.getByRole('status').filter({ hasText: '源码根之外' }).waitFor();
    assert.equal((await management()).instances, 0);
    await main.evaluate(() =>
      Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('manage_java_analysis', {
        action: { kind: 'download' },
        operationKey: crypto.randomUUID(),
      }),
    );
    const search = page.getByRole('textbox', { name: '搜索项目文件' });
    await search.fill('Orbit');
    await search.press('Enter');
    await tree.getByText('Orbit.java', { exact: true }).dblclick();
    await until(async () => /Java 分析就绪|Java 分析失败/.test(await page.locator('footer').innerText()), 'Java startup', 60000);
    assert.match(await page.locator('footer').innerText(), /Java 分析就绪/);
    const state = await management();
    assert.equal(state.instances, 1);
    assert.equal(state.projects, 1);
    await search.fill('');
    await search.press('Enter');
  });
  await check('source watcher refreshes the tree and preserves the edited document on rename', async () => {
    const moved = join(fixture.mod, 'src/Moved.java');
    await rename(join(fixture.mod, 'src/Orbit.java'), moved);
    await page.getByRole('tab').filter({ hasText: 'Moved.java' }).waitFor();
    await tree.getByText('src', { exact: true }).click();
    await tree.getByText('Moved.java', { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, 'code-workspace-native.png') });
  });
  await page.getByTitle('关闭', { exact: true }).click();
  await page.getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
  await check('closing the project workspace releases the JVM and reader lifetime', async () => {
    await until(() => page.isClosed(), 'code editor released');
    await until(async () => (await management()).instances === 0, 'shared JVM released');
  });
  return { openMilliseconds, files: 3, ordinaryTextInstances: 0, javaInstances: 1, finalInstances: 0 };
}
