import assert from 'node:assert/strict';
import { architectureContext } from '../facts/context.mjs';
import { readFileSync } from 'node:fs';

export const readTicketSource = readFileSync(new URL('../../../src/shared/runtime/read-request.ts', import.meta.url), 'utf8');

/** @param {Record<string, string>} sources @returns {import('../facts/context.mjs').ArchitectureContext} */
export function architectureFixtures(sources) {
  const config = JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } });
  return architectureContext(Object.entries({ 'tsconfig.json': config, ...sources }).map(([rel, text]) => ({ path: rel, rel, text })));
}

/** @param {import('../facts/context.mjs').ArchitectureContext} context @param {(file: import('../facts/context.mjs').ArchitectureFile) => boolean} predicate @returns {import('../facts/context.mjs').ArchitectureFile} */
export function fixtureFile(context, predicate) {
  const file = context.files.find(predicate);
  assert.ok(file, 'the declared source fixture exists');
  return file;
}

/** @param {readonly import('../diagnostics.mjs').Diagnostic[]} diagnostics @returns {string[]} */
export function messages(diagnostics) {
  return diagnostics.map(
    ({ file, line, column, message, target }) => file + ':' + line + ':' + column + ': ' + (target ? target + ': ' : '') + message,
  );
}

export const moduleDocumentPath = '.zcode/modules/sample.md';

export const moduleIndexText = '# Module Map\n\n## 模块索引\n\n### 正式模块\n\n- [样例模块](modules/sample.md)：样例职责。\n';

export const moduleDocumentText =
  '# 样例模块\n\n## 定义\n\n样例模块提供样例能力。\n\n## 参考\n\n' +
  '### 拥有\n\n- `assets/icon.png`：图标资源。\n- `src/domain/sample.ts`：领域规则。\n- `src/empty/`：空目录。\n- `tsconfig.json`：源码解析配置。\n\n' +
  '## 边界\n\n- A 输入归领域。\n- B 状态归会话。\n- C 资源归媒体。\n- D 编排归动作。\n- E 展示归组件。\n\n' +
  '## 链路\n\n### 加载\n\n1. 输入进入规则。\n2. 结果交付展示。\n\n### 释放\n\n1. 会话释放等待。\n\n' +
  '## 规范\n\n- A 输入必须绑定身份。\n- B 读取必须绑定票据。\n- C 状态必须归会话。\n- D 结果必须归消费者。\n- E 资源必须归媒体。\n';

/** @param {string} [doc] @param {string} [map] @param {Record<string,string>} [extras] */
export function moduleDocumentFixtures(doc = moduleDocumentText, map = moduleIndexText, extras = {}) {
  return architectureFixtures({
    '.zcode/module-map.md': map,
    [moduleDocumentPath]: doc,
    'src/domain/sample.ts': 'export const value = 1;',
    'assets/icon.png': '',
    'src/empty/': '',
    ...extras,
  });
}

/** @param {Record<string,string>} sources @param {Record<string,string[]>} owners @param {string[]} [shared] */
export function moduleDependencyFixtures(sources, owners, shared = []) {
  const modules = Object.entries(owners);
  return architectureFixtures({
    ...sources,
    '.zcode/module-map.md':
      '# Module Map\n\n## 公共文件\n\n' +
      shared.map((path) => `- \`${path}\`：Public fixture.`).join('\n') +
      '\n\n## 模块索引\n\n### 正式模块\n\n' +
      modules.map(([id]) => `- [${id}](modules/${id}.md)：Fixture.`).join('\n') +
      '\n',
    ...Object.fromEntries(
      modules.map(([id, paths]) => [
        `.zcode/modules/${id}.md`,
        `# ${id}\n\n## 参考\n\n### 拥有\n\n` + paths.map((path) => `- \`${path}\`：Fixture.`).join('\n') + '\n',
      ]),
    ),
  });
}
