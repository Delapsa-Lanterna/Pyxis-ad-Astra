import { appThemes } from '../../../shared/app-themes.mjs';
import assert from 'node:assert/strict';
import { join } from 'node:path';

/** @param {import('playwright').Page} page @param {string} output */
export async function verifyCodeWorkspace(page, output) {
  await page.evaluate(() => {
    const workspace = Reflect.get(globalThis, 'browserWorkspace'),
      project = workspace.projects[1];
    project.manifest.modInfo.name = 'Code sample';
    project.textFiles.set(project.manifest.modRoot + '/notes.txt', 'Sample text');
    project.textFiles.set(project.manifest.modRoot + '/src/Orbit.java', 'class Orbit {}\r\n');
    project.textFiles.set(project.manifest.modRoot + '/Outside.java', 'class Outside {}');
  });
  const main = page.frameLocator('iframe[data-window="main"]');
  await main.getByRole('tab').first().click();
  const reveal = async () => {
    const toggle = main.getByRole('button', { name: '展开导航栏', exact: true });
    if (await toggle.count()) await toggle.click();
  };
  await reveal();
  const navigation = main.locator('.mod-navigation-button').filter({ hasText: '代码编辑器' });
  assert.equal(await main.locator('.mod-navigation-button').last().innerText(), '代码编辑器');
  const began = performance.now();
  await navigation.click();
  const label = await page.evaluate(
    () => [...Reflect.get(globalThis, 'browserWorkspace').windows].find(([, entry]) => entry.context?.kind === 'code-editor')[0],
  );
  const editor = page.frameLocator('iframe[data-window="' + label + '"]');
  await editor.getByRole('heading', { name: '代码总览', exact: true }).waitFor();
  const openMilliseconds = performance.now() - began;
  const javaCalls = () =>
    page.evaluate(
      () =>
        Reflect.get(globalThis, 'browserWorkspace').calls.filter(
          /** @param {{command:string}} entry */ (entry) => entry.command === 'java_editor',
        ).length,
    );
  assert.equal(await javaCalls(), 0);
  const tree = editor.getByRole('complementary', { name: '项目文件' });
  await tree.getByText('notes.txt', { exact: true }).dblclick();
  const surface = editor.getByRole('textbox', { name: '文件内容' });
  await surface.filter({ hasText: 'Sample text' }).waitFor();
  assert.equal(await javaCalls(), 0);
  await surface.fill('Changed text');
  await main.getByRole('tab').first().click();
  await reveal();
  await navigation.click();
  assert.equal(await editor.getByRole('tab').count(), 1);
  assert.match(await surface.innerText(), /Changed text/);
  await tree.getByText('Outside.java', { exact: true }).dblclick();
  await editor.getByRole('status').filter({ hasText: '源码根之外' }).waitFor();
  assert.equal(await javaCalls(), 0);
  const search = editor.getByRole('textbox', { name: '搜索项目文件' });
  await search.fill('Orbit');
  await search.press('Enter');
  await tree.getByText('Orbit.java', { exact: true }).dblclick();
  await editor.locator('footer').filter({ hasText: 'Java 分析就绪' }).waitFor();
  const before = await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').calls.length);
  await editor.getByRole('tab').filter({ hasText: 'notes.txt' }).click();
  await editor.getByRole('tab').filter({ hasText: 'Orbit.java' }).click();
  const switched = await page.evaluate(
    (from) =>
      Reflect.get(globalThis, 'browserWorkspace')
        .calls.slice(from)
        .filter(/** @param {{command:string}} entry */ (entry) => /^(load_text_file|java_editor)$/.test(entry.command)).length,
    before,
  );
  assert.equal(switched, 0);
  await search.fill('');
  await search.press('Enter');
  await page.evaluate(async () => {
    const workspace = Reflect.get(globalThis, 'browserWorkspace'),
      library = workspace.projects[2];
    library.manifest.modInfo.name = 'Reference sample';
    const file = library.manifest.modRoot + '/src/Library.java';
    library.textFiles.set(file, 'class Library {}');
    workspace.javaQueries.facts.set(file, { source: 'class Library {}', diagnostics: [], outline: [], locations: [] });
    await workspace.invoke('main', 'set_reference_sources', {
      sessionIds: [library.manifest.sessionId],
      order: workspace.projects.map(/** @param {{manifest:{sessionId:string}}} item */ (item) => item.manifest.sessionId),
    });
  });
  await tree.getByRole('button', { name: 'Reference sample (引用，只读)', exact: true }).click();
  await tree.getByText('Library.java', { exact: true }).dblclick();
  await editor.getByRole('tab').filter({ hasText: '引用，只读' }).waitFor();
  assert.equal(await surface.getAttribute('contenteditable'), 'false');
  await page.evaluate(() =>
    Reflect.get(globalThis, 'browserWorkspace').invoke('main', 'set_reference_sources', { sessionIds: [], order: [] }),
  );
  await tree.getByRole('button', { name: 'Reference sample (引用，只读)', exact: true }).waitFor({ state: 'detached' });
  await editor.getByRole('tab').filter({ hasText: 'Orbit.java' }).click();
  await main.getByRole('button', { name: '打开原版', exact: true }).click();
  await reveal();
  await navigation.click();
  const coreLabel = await page.evaluate(
    () =>
      [...Reflect.get(globalThis, 'browserWorkspace').windows].find(
        ([, entry]) => entry.context?.kind === 'code-editor' && entry.context.identity.modRoot.endsWith('starsector-core'),
      )[0],
  );
  await page
    .frameLocator('iframe[data-window="' + coreLabel + '"]')
    .getByRole('heading', { name: '代码总览', exact: true })
    .waitFor();
  await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').setAppearance({ theme: 'light' }));
  await main.getByRole('tab').first().click();
  for (const theme of appThemes)
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => Reflect.get(globalThis, 'browserWorkspace').setAppearance({ theme }), theme);
      await tree.getByRole('button', { name: 'Code sample', exact: true }).waitFor();
      await editor.locator('.code-editor').screenshot({ path: join(output, `code-workspace-${theme}-${width}.png`) });
    }
  return [
    {
      name: 'formal navigation, empty window, text, root scope, lazy Java and loaded switching',
      pass: true,
      openMilliseconds,
      switchReadsAndIpc: switched,
    },
  ];
}
