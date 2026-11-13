import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openEditorSample } from './editors.mjs';

/** @param {import('playwright').Page} page @param {string} output */
export async function verifySourceActions(page, output) {
  const editor = await openEditorSample(page),
    surface = editor.getByRole('textbox', { name: '文件内容' });
  await surface.fill('class Orbit {}\r\n');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.locator('footer').filter({ hasText: '已保存' }).waitFor();
  await page.evaluate(() => {
    const workspace = Reflect.get(globalThis, 'browserWorkspace');
    const project = workspace.projects.find(
      /** @param {{manifest:{modRoot:string}}} entry */ (entry) => entry.manifest.modRoot.endsWith('/code_sample'),
    );
    const file = project.manifest.modRoot + '/src/Third.java';
    const common = {
      assistance: true,
      project: 'fixture',
      revision: 0,
      file,
      version: 1,
      argument: 0,
      candidates: [],
      files: [],
      choices: [],
      conflicts: [],
    };
    workspace.javaQueries.assists.set(file + ':rename', {
      ...common,
      purpose: 'rename',
      files: [{ file, version: 1, source: 'class Orbit {}\n', target: null, edits: [{ from: 6, to: 11, text: 'Beacon' }] }],
    });
    workspace.javaQueries.assists.set(file + ':signature', {
      ...common,
      purpose: 'signature',
      candidates: [{ label: 'value', text: 'value()', detail: 'String (int)', from: 0, to: 0, relevance: 1 }],
    });
    workspace.javaQueries.assists.set(file + ':complete', {
      ...common,
      purpose: 'complete',
      candidates: [{ label: 'value', text: 'value()', detail: 'String (int)', from: 0, to: 3, relevance: 1 }],
    });
    workspace.javaQueries.assists.set(file + ':imports', {
      ...common,
      purpose: 'imports',
      choices: [{ name: 'List', candidates: ['java.util.List', 'java.awt.List'] }],
    });
  });
  await surface.fill('');
  await surface.pressSequentially('val');
  await editor.getByRole('option').filter({ hasText: 'value' }).click();
  assert.equal(await surface.innerText(), 'value()');
  await surface.press('Control+End');
  await surface.pressSequentially('(');
  await editor.locator('.code-signature').waitFor();
  await surface.fill('class Orbit {}');
  await editor.getByRole('button', { name: 'Java 操作', exact: true }).click();
  await editor.getByRole('button', { name: '参数提示', exact: true }).click();
  await editor.locator('.code-signature').waitFor();
  await surface.click();
  await surface.fill('class Orbit {List<String> values;}');
  await editor.getByRole('button', { name: 'Java 操作', exact: true }).click();
  await editor.getByRole('button', { name: '整理导入', exact: true }).click();
  await editor.getByRole('region', { name: '修改预览' }).locator('.n-select').click();
  await editor.getByText('java.util.List', { exact: true }).click();
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await surface.fill('class Orbit {}\r\n');
  await editor.getByRole('button', { name: 'Java 操作', exact: true }).click();
  await editor.getByRole('textbox', { name: '重命名的新名称' }).fill('Beacon');
  await editor.getByRole('button', { name: '预览重命名', exact: true }).click();
  await editor.getByRole('region', { name: '修改预览' }).waitFor();
  assert.match(await surface.innerText(), /class Orbit/);
  await editor.getByRole('button', { name: '接纳整批修改', exact: true }).click();
  await surface.filter({ hasText: 'class Beacon' }).waitFor();
  await surface.focus();
  await surface.press('Control+z');
  assert.match(await surface.innerText(), /class Orbit/);
  await surface.press('Control+y');
  assert.match(await surface.innerText(), /class Beacon/);
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.locator('footer').filter({ hasText: '已保存' }).waitFor();
  for (const theme of ['light', 'dark'])
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => Reflect.get(globalThis, 'browserWorkspace').setAppearance({ theme }), theme);
      await editor.locator('.code-editor').screenshot({ path: join(output, `source-actions-${theme}-${width}.png`) });
    }
  return [{ name: 'automatic completion, typed parameter hints, preview, grouped undo/redo and batch save', pass: true }];
}
