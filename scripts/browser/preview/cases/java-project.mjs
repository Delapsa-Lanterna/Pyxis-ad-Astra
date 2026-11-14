import { appThemes } from '../../../shared/app-themes.mjs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openEditorSample } from './editors.mjs';
/** @param {import('playwright').Page} page @param {string} output */
export async function verifyJavaProject(page, output) {
  const editor = await openEditorSample(page);
  await editor.getByRole('button', { name: '打开代码总览', exact: true }).click();
  await editor.getByRole('region', { name: 'Java 工程设置' }).waitFor();
  assert.equal(await editor.getByRole('region', { name: '任务结果', exact: true }).count(), 0);
  assert.equal(await editor.locator('.code-overview .empty-state').count(), 0);
  await editor.getByRole('textbox', { name: '工程源码目录' }).fill('source/main\ngenerated');
  await editor.getByRole('textbox', { name: '工程主 JAR' }).fill('jars/sample.jar');
  await editor.getByRole('heading', { name: '工程配置', exact: true }).click();
  const before = await page.evaluate(
    () =>
      Reflect.get(globalThis, 'browserWorkspace').calls.filter(
        /** @param {{command:string}} entry */ (entry) => entry.command === 'java_project',
      ).length,
  );
  await editor.getByRole('tab').last().click();
  await editor.getByRole('button', { name: '打开代码总览', exact: true }).click();
  assert.equal(
    await page.evaluate(
      () =>
        Reflect.get(globalThis, 'browserWorkspace').calls.filter(
          /** @param {{command:string}} entry */ (entry) => entry.command === 'java_project',
        ).length,
    ),
    before,
  );
  assert.equal(await editor.getByRole('textbox', { name: '工程源码目录' }).inputValue(), 'source/main\ngenerated');
  await editor.getByRole('button', { name: '检测环境', exact: true }).click();
  await editor.getByRole('button', { name: '查看输出', exact: true }).click();
  await editor.getByText('java.specification.version = 17', { exact: true }).waitFor();
  await editor.getByRole('button', { name: '使用 javac 编译并生成 JAR', exact: true }).click();
  await editor.getByText('842 字节 · preview-artifact', { exact: true }).waitFor();
  await editor.getByRole('button', { name: '部署', exact: true }).click();
  await editor.getByRole('dialog').filter({ hasText: '部署 Java 产物？' }).waitFor();
  await editor.getByRole('button', { name: '返回', exact: true }).click();
  await editor.getByRole('dialog').filter({ hasText: '部署 Java 产物？' }).waitFor({ state: 'hidden' });
  assert.equal(await editor.getByRole('button', { name: '部署', exact: true }).isEnabled(), true);
  assert.equal(await editor.locator('.code-overview .empty-state').count(), 0);
  for (const theme of appThemes)
    for (const width of [1602, 2242]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((theme) => Reflect.get(globalThis, 'browserWorkspace').setAppearance({ theme }), theme);
      await editor.locator('.code-overview').evaluate((element) => element.scrollTo({ top: 0 }));
      await editor.locator('.code-overview').screenshot({ path: join(output, `java-project-${theme}-${width}.png`) });
      await editor.getByRole('region', { name: '工程任务与产物' }).screenshot({ path: join(output, `java-build-${theme}-${width}.png`) });
    }
  const main = page.frameLocator('iframe[data-window="main"]');
  await main.getByRole('button', { name: '工作区菜单', exact: true }).click();
  await main.getByText('设置', { exact: true }).click();
  await main.getByRole('heading', { name: '设置', exact: true }).waitFor();
  for (const [key, font] of [
    ['interfaceFont', 'Arial'],
    ['fieldFont', 'Consolas'],
    ['textEditorFont', 'Courier New'],
  ]) {
    await main
      .locator('.schema-field')
      .filter({ hasText: key === 'interfaceFont' ? /^界面字体/ : key === 'fieldFont' ? /^字段字体/ : /^文本编辑器字体/ })
      .locator('.n-base-selection')
      .click();
    await main
      .locator('.n-base-select-option:visible')
      .filter({ hasText: new RegExp('^' + font + '$') })
      .click();
    await main.locator('.n-base-select-menu:visible').waitFor({ state: 'hidden' });
  }
  await editor.locator('.page-title').evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    if (!style.fontFamily.startsWith('Arial')) throw Error('Interface font setting did not reach the heading');
  });
  await editor.getByRole('textbox', { name: '工程源码目录' }).evaluate((element) => {
    if (!globalThis.getComputedStyle(element).fontFamily.startsWith('Consolas')) throw Error('Field font setting did not reach the input');
  });
  await editor.getByRole('tab').last().click();
  await editor.locator('.cm-content').evaluate((element) => {
    if (!globalThis.getComputedStyle(element).fontFamily.startsWith('"Courier New"'))
      throw Error('Editor font setting did not reach the content');
  });
  await page.evaluate(() => {
    const project = Reflect.get(globalThis, 'browserWorkspace').projects.find((/** @type {{manifest:{modRoot:string}}} */ project) =>
      project.manifest.modRoot.endsWith('/code_sample'),
    );
    project.textFiles.set(project.manifest.modRoot + '/build.gradle', "tasks.register('inspectAssets') {}");
  });
  await editor.getByRole('button', { name: '打开代码总览', exact: true }).click();
  await editor.getByRole('switch', { name: '使用 Gradle' }).click();
  await editor.locator('[aria-label="使用 Gradle"][aria-checked="true"]').waitFor();
  const task = editor
    .locator('.schema-field')
    .filter({ hasText: /^项目任务/ })
    .locator('.n-base-selection');
  await task.click();
  await editor
    .locator('.n-base-select-option:visible')
    .filter({ hasText: /^:inspectAssets$/ })
    .click();
  await editor.getByRole('heading', { name: '构建与部署', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Gradle 任务参数' }).fill('-Psample=value');
  await editor.getByRole('button', { name: '运行 Gradle', exact: true }).click();
  await editor.getByText(':inspectAssets -Psample=value', { exact: true }).first().waitFor();
  for (const theme of appThemes)
    for (const width of [1602, 2242]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((theme) => Reflect.get(globalThis, 'browserWorkspace').setAppearance({ theme }), theme);
      await editor.getByRole('region', { name: '工程任务与产物' }).screenshot({ path: join(output, `gradle-tasks-${theme}-${width}.png`) });
    }
  return [{ name: 'project overview, settings, local reuse, build result, deployment preview cancellation and theme layouts', pass: true }];
}
