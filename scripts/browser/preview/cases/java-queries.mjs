import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openEditorSample } from './editors.mjs';

/** @param {import('playwright').Page} page @param {string} output */
export async function verifyJavaQueries(page, output) {
  const editor = await openEditorSample(page);
  const source = '// 星🪐\r\nclass Orbit { Object run(){ return Library.value(); } }';
  await page.evaluate(
    ({ source }) => {
      const workspace = Reflect.get(globalThis, 'browserWorkspace');
      const root = workspace.projects.find(
        /** @param {{manifest:{modRoot:string}}} project */ (project) => project.manifest.modRoot.endsWith('/code_sample'),
      ).manifest.modRoot;
      const file = root + '/src/Third.java',
        reference = root.replace('/code_sample', '/reference_sample') + '/src/Library.java';
      const fact = {
        purpose: 'document',
        project: 'sample',
        revision: 1,
        file,
        version: 1,
        source,
        origin: 'fixture-api.jar',
        binding: { name: 'value', owner: 'Library', type: 'java.lang.String', parameters: [], binary: false },
        diagnostics: [
          {
            file,
            version: 1,
            severity: 'warning',
            start: source.indexOf('Orbit'),
            end: source.indexOf('Orbit') + 5,
            line: 2,
            message: '示例警告',
          },
        ],
        outline: [
          { name: 'Orbit', kind: 'TypeDeclaration', depth: 0, range: { start: source.indexOf('Orbit'), end: source.indexOf('Orbit') + 5 } },
          { name: 'run', kind: 'MethodDeclaration', depth: 1, range: { start: source.indexOf('run'), end: source.indexOf('run') + 3 } },
        ],
        locations: [{ file: reference, version: 1, range: { start: 6, end: 13 } }],
      };
      workspace.javaQueries.facts.set(file, fact);
      workspace.javaQueries.facts.set(reference, {
        ...fact,
        file: reference,
        source: 'class Library { static String value(){ return "fixture"; } }',
        locations: [],
        diagnostics: [],
        outline: [
          { name: 'Library', kind: 'TypeDeclaration', depth: 0, range: { start: 6, end: 13 } },
          { name: 'value', kind: 'MethodDeclaration', depth: 1, range: { start: 30, end: 35 } },
        ],
      });
    },
    { source },
  );
  const surface = editor.getByRole('textbox', { name: '文件内容' });
  await surface.fill(source);
  await editor.getByRole('status').filter({ hasText: 'Java 分析就绪' }).waitFor();
  const expandOutline = editor.getByRole('button', { name: '展开大纲', exact: true });
  if (await expandOutline.count()) await expandOutline.click();
  await editor.getByRole('button', { name: 'run', exact: true }).waitFor();
  await editor.getByRole('button', { name: '诊断与引用', exact: true }).click();
  await editor.getByRole('button', { name: /示例警告/ }).waitFor();
  assert.equal(await editor.locator('.code-diagnostic-warning').count(), 1);
  await editor.getByRole('button', { name: 'Java 操作', exact: true }).click();
  await editor.getByRole('button', { name: '查找引用', exact: true }).click();
  await editor.getByText('fixture-api.jar', { exact: false }).waitFor();
  await editor.getByRole('button', { name: '跳转声明', exact: true }).click();
  await editor.getByRole('tab', { name: /引用，只读/ }).waitFor();
  assert.equal(await surface.getAttribute('contenteditable'), 'false');
  assert.equal(await editor.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await editor.locator('.code-editor').screenshot({ path: join(output, 'java-queries.png') });
  return [{ name: 'fixture diagnostics, outline, references, declaration and read-only snapshot', pass: true }];
}
