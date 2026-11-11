import assert from 'node:assert/strict';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { until } from '../runtime.mjs';
import { summarize } from '../../shared/sample-statistics.mjs';

/** @param {import('./registry.mjs').DesktopCase} context */
export async function javaQueries(
  context,
  actions = /** @type {((entry:{app:Awaited<ReturnType<import('./registry.mjs').DesktopCase['launch']>>,page:import('playwright').Page,file:string,manifest:{sessionId:string,modRoot:string}})=>Promise<Record<string,unknown>>) | undefined} */ (
    undefined
  ),
) {
  const { fixture, check, options, artifacts } = context;
  if (!options.game) throw Error('Java queries require --game for the real Java 17 runtime');
  const source = '// 星🪐\r\nclass Orbit { Object run(){return Library.value();} }\r';
  const file = join(fixture.mod, 'src/Orbit.java'),
    libraryRoot = join(fixture.game, 'mods/library'),
    library = join(libraryRoot, 'src/Library.java');
  await mkdir(join(fixture.mod, 'src'), { recursive: true });
  await mkdir(join(libraryRoot, 'src'), { recursive: true });
  await writeFile(file, source);
  await writeFile(join(libraryRoot, 'mod_info.json'), '{"id":"library","name":"Library","version":"1"}');
  await writeFile(library, 'public class Library { public static String value(){return "fixture";} }');
  const app = await context.launch();
  await app.main.evaluate(async (game) => {
    const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke;
    const settings = await invoke('read_settings');
    await invoke('save_settings', { payload: { settings: { ...settings.value, starsectorRoot: game, javaExecutable: null } } });
  }, options.game);
  /** @param {import('playwright').Page} page @param {Record<string,unknown>} action */
  const action = (page, action) =>
    page.evaluate((action) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('java_editor', { action }), action);
  /** @param {string} root */
  const open = (root) =>
    app.main.evaluate(
      ({ root, game }) =>
        Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_project_session', { payload: { modRoot: root, starsectorRoot: game } }),
      { root, game: options.game },
    );
  const manifest = await open(fixture.mod),
    reference = await open(libraryRoot);
  const installation = await app.main.evaluate(
    ({ archive }) =>
      Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('manage_java_analysis', {
        action: { kind: 'import', archive },
        operationKey: crypto.randomUUID(),
      }),
    { archive: resolve('src-tauri/target/java-analysis/jdt-dependencies.zip') },
  );
  assert.equal(installation.installation, 'installed', installation.error ?? 'Java component imported');
  /** @param {string[]} ids */
  const references = (ids) =>
    app.main.evaluate(
      ({ sessionIds, order }) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('set_reference_sources', { sessionIds, order }),
      { sessionIds: ids, order: [reference.sessionId, manifest.sessionId] },
    );
  await references([reference.sessionId]);
  const opening = app.main.evaluate(
    (input) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_code_editor', { input, key: crypto.randomUUID() }),
    { ...manifest, files: [{ path: file }] },
  );
  /** @type {import('playwright').Page | undefined} */
  let editor;
  await until(() => {
    editor = app.context.pages().find((page) => page !== app.main);
    return Boolean(editor);
  }, 'Java code editor created');
  await opening;
  const page = editor;
  assert.ok(page);
  const surface = page.getByRole('textbox', { name: '文件内容' });
  await check('real Java startup and five editor projections', async () => {
    await until(
      async () => /Java 分析就绪|Java 分析失败/.test(await page.locator('footer').innerText()),
      'Java editor startup result',
      60000,
    );
    const status = await page.locator('footer').innerText();
    if (!status.includes('Java 分析就绪')) {
      await page.screenshot({ path: join(artifacts, 'java-startup.png') });
      const error = await page.evaluate(async () => {
        try {
          await Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('java_editor', { action: { kind: 'start' } });
          return null;
        } catch (error) {
          return error;
        }
      });
      const java = await app.main.evaluate(
        (sessionId) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('java_analysis_context', { sessionId, gameRoot: null }),
        manifest.sessionId,
      );
      assert.fail(status + '\n' + JSON.stringify({ java, error }));
    }
    await page.getByRole('button', { name: 'run', exact: true }).waitFor();
    const hover = await action(page, { kind: 'inspect', file, offset: source.indexOf('value'), purpose: 'hover' });
    assert.equal(hover.result.binding.type, 'java.lang.String');
    assert.deepEqual(hover.result.locations, []);
    const declaration = await action(page, { kind: 'inspect', file, offset: source.indexOf('value'), purpose: 'declaration' });
    assert.equal(declaration.result.locations.length, 1);
    await surface.press('Control+f');
    await page.getByRole('textbox', { name: '查找', exact: true }).fill('value');
    await page.getByRole('textbox', { name: '查找', exact: true }).press('Enter');
    await page.getByRole('textbox', { name: '查找', exact: true }).press('Escape');
    const point = await page.evaluate(() => {
      const { document, NodeFilter } = globalThis;
      const walker = document.createTreeWalker(/** @type {HTMLElement} */ (document.querySelector('.cm-content')), NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const index = String(node.textContent).indexOf('value');
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index + 1);
        range.setEnd(node, index + 2);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      throw Error('Expected fixture method token');
    });
    await page.mouse.move(point.x, point.y);
    await page.locator('.cm-tooltip').filter({ hasText: 'java.lang.String' }).waitFor();
    await page.mouse.click(point.x, point.y);
    await page.getByRole('button', { name: '查找引用', exact: true }).click();
    await page.getByRole('region', { name: '诊断与引用' }).waitFor();
    await page.getByRole('button', { name: '跳转声明', exact: true }).click();
    await page.getByRole('tab', { name: /引用，只读/ }).waitFor();
    assert.equal(await surface.getAttribute('contenteditable'), 'false');
    await page.getByRole('tab').filter({ hasText: 'Orbit.java' }).click();
  });
  await check('automatic reference removal and restoration updates the existing project', async () => {
    await references([]);
    await until(
      async () =>
        (await action(page, { kind: 'inspect', file, offset: 0, purpose: 'document' })).result.diagnostics.some(
          /** @param {{severity:string}} entry */ (entry) => entry.severity === 'error',
        ),
      'missing reference diagnostic',
    );
    await references([reference.sessionId]);
    const restored = await action(page, { kind: 'inspect', file, offset: source.indexOf('value'), purpose: 'hover' });
    assert.equal(restored.result.binding.type, 'java.lang.String');
  });
  const editing = actions ? await actions({ app, page, file, manifest }) : {};
  const samples = /** @type {number[]} */ ([]),
    bytes = /** @type {number[]} */ ([]);
  await check('typing, queued source queries, signatures and rename use the current draft', async () => {
    await surface.fill(source.replace('Object run()', 'String run()'));
    await until(
      async () => (await action(page, { kind: 'inspect', file, offset: 0, purpose: 'source' })).result.source.includes('String run()'),
      'debounced draft submitted',
    );
    for (let index = 0; index < 30; index++) {
      const began = performance.now(),
        result = await action(page, { kind: 'inspect', file, offset: source.indexOf('value'), purpose: 'hover' });
      samples.push(performance.now() - began);
      bytes.push(Buffer.byteLength(JSON.stringify(result)));
    }
    const moved = join(fixture.mod, 'src/Moved.java');
    await rename(file, moved);
    await page.getByRole('button', { name: '保留文本并跟随', exact: true }).click();
    await page.getByRole('tab').filter({ hasText: 'Moved.java' }).waitFor();
    await until(
      async () =>
        (await action(page, { kind: 'inspect', file: moved, offset: 0, purpose: 'source' })).result.source.includes('String run()'),
      'renamed draft submitted',
    );
    await page.screenshot({ path: join(artifacts, 'java-native.png') });
  });
  await page.getByTitle('关闭', { exact: true }).click();
  await page.getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
  await check('last Java window releases the shared JVM', async () => {
    await until(() => page.isClosed(), 'Java editor destroyed');
    await until(async () => {
      const state = await app.main.evaluate(() =>
        Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('manage_java_analysis', {
          action: { kind: 'refresh' },
          operationKey: crypto.randomUUID(),
        }),
      );
      return state.instances === 0 && state.projects === 0;
    }, 'Java projects and JVM released');
  });
  return { hoverRoundtrip: summarize(samples), responseBytes: summarize(bytes), samples, bytes, references: 1, rawUtf16: true, editing };
}
