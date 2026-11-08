import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messages, moduleDocumentFixtures, moduleDocumentText, moduleDocumentPath, moduleIndexText } from '../../testing/fixtures.mjs';
import { moduleStructureRule } from './module-structure.mjs';

const malformedDocs = [
  ['unknown H2', moduleDocumentText.replace('## 规范', '## 其它')],
  ['extra H2', moduleDocumentText + '\n## 陷阱\n\n- A 输入必须绑定身份。\n'],
  ['duplicate H2', moduleDocumentText.replace('## 规范', '## 边界\n\n## 规范')],
  ['reordered H2', moduleDocumentText.replace('## 边界', '## 规范').replace(/## 规范(?=\n\n- A 输入必须)/, '## 边界')],
  ['missing H2', moduleDocumentText.replace('## 规范\n\n', '')],
  ['closed H2', moduleDocumentText.replace('## 定义', '## 定义 ##')],
  ['content before 定义', moduleDocumentText.replace('## 定义', '额外内容\n\n## 定义')],
  ['extra H1', moduleDocumentText.replace('- A 输入归领域。', '# 额外标题')],
  ['H3 outside 参考 and 链路', moduleDocumentText.replace('- A 输入归领域。', '### 越界标题')],
  ['H4 inside 链路', moduleDocumentText.replace('### 加载', '#### 加载')],
  ['closed H3', moduleDocumentText.replace('### 加载', '### 加载 ###')],
  ['indented H3', moduleDocumentText.replace('### 加载', '  ### 加载')],
  ['empty H3', moduleDocumentText.replace('### 加载', '### ')],
  ['empty definition', moduleDocumentText.replace('样例模块提供样例能力。', '')],
  ['multiline definition', moduleDocumentText.replace('样例模块提供样例能力。', '第一行。\n第二行。')],
  ['definition list', moduleDocumentText.replace('样例模块提供样例能力。', '- 一行列表。')],
  ['definition table', moduleDocumentText.replace('样例模块提供样例能力。', '| 一行表格 |')],
  ['definition HTML', moduleDocumentText.replace('样例模块提供样例能力。', '<div>正文</div>')],
  ['inline HTML heading', moduleDocumentText.replace('样例模块提供样例能力。', '正文<h2>其它</h2>')],
  ['inline HTML comment', moduleDocumentText.replace('- A 输入归领域。', '- A 输入归领域。<!--额外内容-->')],
  ['inline image', moduleDocumentText.replace('- A 输入归领域。', '- A 输入归领域。![image](asset.png)')],
  ['definition heading', moduleDocumentText.replace('样例模块提供样例能力。', '### 单行标题')],
  ['paragraph in 边界', moduleDocumentText.replace('- A 输入归领域。', 'A 输入归领域。')],
  ['ordered list in 规范', moduleDocumentText.replace('- A 输入必须绑定身份。', '1. A 输入必须绑定身份。')],
  ['table in 规范', moduleDocumentText.replace('- A 输入必须绑定身份。', '| A | B |')],
  ['fence in 规范', moduleDocumentText.replace('- A 输入必须绑定身份。', '```js\nconst x = 1;\n```')],
  ['nested unordered list', moduleDocumentText.replace('- B 状态归会话。', '  - B 状态归会话。')],
  ['alternative unordered marker', moduleDocumentText.replace('- B 状态归会话。', '* B 状态归会话。')],
  ['loose unordered list', moduleDocumentText.replace('- B 状态归会话。', '\n- B 状态归会话。')],
  ['unordered continuation', moduleDocumentText.replace('- B 状态归会话。', '- B 状态归会话。\n  续行。')],
  ['duplicate unordered entry', moduleDocumentText.replace('- B 状态归会话。', '- A 输入归领域。')],
  ['chain without H3', moduleDocumentText.replace('### 加载\n\n', '')],
  ['empty chain', moduleDocumentText.replace('1. 输入进入规则。\n2. 结果交付展示。', '')],
  ['chain paragraph', moduleDocumentText.replace('1. 输入进入规则。', '输入进入规则。')],
  ['chain unordered list', moduleDocumentText.replace('1. 输入进入规则。', '- 输入进入规则。')],
  ['loose chain list', moduleDocumentText.replace('2. 结果交付展示。', '\n2. 结果交付展示。')],
  ['chain numbering gap', moduleDocumentText.replace('2. 结果交付展示。', '3. 结果交付展示。')],
  ['chain numbering starts at two', moduleDocumentText.replace('1. 会话释放等待。', '2. 会话释放等待。')],
  ['chain numbering leading zero', moduleDocumentText.replace('1. 会话释放等待。', '01. 会话释放等待。')],
  ['nested chain step', moduleDocumentText.replace('2. 结果交付展示。', '  2. 结果交付展示。')],
  ['alternative ordered delimiter', moduleDocumentText.replace('2. 结果交付展示。', '2) 结果交付展示。')],
  ['duplicate chain title', moduleDocumentText.replace('### 释放', '### 加载')],
  ['extra paragraph after chain', moduleDocumentText.replace('## 规范', '额外正文\n\n## 规范')],
  ['missing heading separator', moduleDocumentText.replace('## 定义\n\n', '## 定义\n')],
  ['extra blank line', moduleDocumentText.replace('## 定义\n\n', '## 定义\n\n\n')],
  ['trailing whitespace', moduleDocumentText.replace('样例模块提供样例能力。', '样例模块提供样例能力。 ')],
  ['missing final newline', moduleDocumentText.trimEnd()],
  ['extra final blank', moduleDocumentText + '\n'],
  ['reference nested bullet', moduleDocumentText.replace('`assets/icon.png`', '- `assets/icon.png`')],
  ['reference missing group', moduleDocumentText.replace('### 拥有\n\n', '')],
  ['reference unknown group', moduleDocumentText.replace('### 拥有', '### 其它')],
  ['reference missing marker', moduleDocumentText.replace('- `assets/icon.png`', '`assets/icon.png`')],
  ['reference missing colon', moduleDocumentText.replace('`assets/icon.png`：', '`assets/icon.png` ')],
  ['reference ASCII colon', moduleDocumentText.replace('`assets/icon.png`：', '`assets/icon.png`:')],
  ['reference missing remark', moduleDocumentText.replace('`assets/icon.png`：图标资源。', '`assets/icon.png`：')],
  ['reference multiple paths', moduleDocumentText.replace('`assets/icon.png`', '`assets/icon.png`、`src/domain/sample.ts`')],
  ['reference symbol suffix', moduleDocumentText.replace('`src/domain/sample.ts`', '`src/domain/sample.ts:value`')],
  ['reference glob', moduleDocumentText.replace('`src/domain/sample.ts`', '`src/domain/*.ts`')],
  ['reference traversal', moduleDocumentText.replace('`src/domain/sample.ts`', '`src/../domain/sample.ts`')],
  ['reference backslash', moduleDocumentText.replace('`src/domain/sample.ts`', '`src\\domain\\sample.ts`')],
  ['reference absolute path', moduleDocumentText.replace('`src/domain/sample.ts`', '`/src/domain/sample.ts`')],
  ['reference missing file', moduleDocumentText.replace('`assets/icon.png`', '`assets/missing.png`')],
  ['reference missing directory', moduleDocumentText.replace('`src/empty/`', '`src/missing/`')],
  ['reference loose lines', moduleDocumentText.replace('`src/domain/sample.ts`', '\n`src/domain/sample.ts`')],
  [
    'reference dictionary order',
    moduleDocumentText.replace(
      '- `assets/icon.png`：图标资源。\n- `src/domain/sample.ts`：领域规则。',
      '- `src/domain/sample.ts`：领域规则。\n- `assets/icon.png`：图标资源。',
    ),
  ],
  ['reference duplicate path', moduleDocumentText.replace('`src/domain/sample.ts`', '`assets/icon.png`')],
  [
    'reference directory aliases',
    moduleDocumentText.replace('`src/empty/`：空目录。', '`src/empty`：空目录。\n- `src/empty/`：重复目录。'),
  ],
  ['title mismatch', moduleDocumentText.replace('# 样例模块', '# 其它模块')],
  ['line limit', moduleDocumentText.replace('样例模块提供样例能力。', Array.from({ length: 301 }, () => '正文。').join('\n'))],
];

test('canonical modules accept exact headings, compact lists, real files, empty directories and binary assets', () => {
  assert.deepEqual(messages(moduleStructureRule.check(moduleDocumentFixtures())), []);
});

test('CRLF keeps the same structure and reference path order', () => {
  assert.deepEqual(messages(moduleStructureRule.check(moduleDocumentFixtures(moduleDocumentText.replace(/\n/g, '\r\n')))), []);
});

test('dictionary order applies only to reference paths while other sections retain reading order', () => {
  const doc = moduleDocumentText
    .replace('- A 输入归领域。\n- B 状态归会话。', '- B 状态归会话。\n- A 输入归领域。')
    .replace('- A 输入必须绑定身份。\n- B 读取必须绑定票据。', '- B 读取必须绑定票据。\n- A 输入必须绑定身份。')
    .replace(
      '### 加载\n\n1. 输入进入规则。\n2. 结果交付展示。\n\n### 释放\n\n1. 会话释放等待。',
      '### 释放\n\n1. 会话释放等待。\n\n### 加载\n\n1. 输入进入规则。\n2. 结果交付展示。',
    );
  assert.deepEqual(messages(moduleStructureRule.check(moduleDocumentFixtures(doc))), []);
});

for (const section of ['边界', '规范']) {
  test(`${section} rejects a repeated entry anywhere in its chosen reading order`, () => {
    const start = moduleDocumentText.indexOf('## ' + section + '\n\n');
    const doc =
      moduleDocumentText.slice(0, start) + moduleDocumentText.slice(start).replace(/(- A [^\n]+)(\n- B [^\n]+\n)- C [^\n]+/, '$1$2$1');
    const failures = moduleStructureRule.check(moduleDocumentFixtures(doc));
    assert.equal(failures.length, 1);
    assert.ok(failures[0]);
    assert.equal(failures[0].message, `${section} entries must be unique`);
    assert.equal(failures[0].file, moduleDocumentPath);
    assert.equal(failures[0].column, 1);
  });
}

test('reference groups express distinct roles with compact, independently sorted paths', () => {
  const doc = moduleDocumentText
    .replace(
      '- `src/domain/sample.ts`：领域规则。\n- `src/empty/`：空目录。',
      '### 消费\n\n- `src/domain/sample.ts`：消费唯一实例。\n\n### 装配\n\n- `src/empty/`：宿主入口。\n\n### 关联\n\n- `AGENTS.md`：项目约束。',
    )
    .replace('：图标资源。\n###', '：图标资源。\n\n###');
  assert.deepEqual(messages(moduleStructureRule.check(moduleDocumentFixtures(doc, moduleIndexText, { 'AGENTS.md': '' }))), []);
  for (const invalid of [
    doc.replace('### 消费', '### 装配'),
    doc.replace('### 消费', '### 关联').replace('### 关联\n\n- `AGENTS.md`', '### 消费\n\n- `AGENTS.md`'),
    doc.replace('- `src/domain/sample.ts`：消费唯一实例。', ''),
    doc.replace('`src/empty/`', '`assets/icon.png`'),
  ])
    assert.ok(messages(moduleStructureRule.check(moduleDocumentFixtures(invalid, moduleIndexText, { 'AGENTS.md': '' }))).length > 0);
});

test('every module reference group rejects test entry files', () => {
  for (const group of ['拥有', '消费', '装配', '关联'])
    for (const path of [
      'src/domain/sample.spec.ts',
      'src/domain/sample.test.tsx',
      'scripts/sample.check.mjs',
      'src-tauri/src/sample_test.rs',
      'src-tauri/src/sample_tests.rs',
    ]) {
      const doc = moduleDocumentText.replace('### 拥有', '### ' + group).replace('src/domain/sample.ts', path);
      const context = moduleDocumentFixtures(doc, moduleIndexText, { [path]: '' });
      const failure = moduleStructureRule.check(context).find((item) => item.message.includes('must not reference test files'));
      assert.ok(failure);
      assert.equal(failure.ruleId, 'module-structure');
      assert.equal(failure.file, moduleDocumentPath);
      assert.equal(failure.line, doc.split('\n').findIndex((line) => line.includes('- `' + path + '`')) + 1);
      assert.equal(failure.column, 1);
    }
});

test('production check entry points and shared fixture helpers remain valid references', () => {
  for (const path of ['scripts/architecture/check.mjs', 'src/test/fixtures/settings.ts', 'src/test/unit/ui-stubs.ts']) {
    const doc = moduleDocumentText.replace('src/domain/sample.ts', path);
    assert.equal(
      moduleStructureRule
        .check(moduleDocumentFixtures(doc, moduleIndexText, { [path]: '' }))
        .some((item) => item.message.includes('must not reference test files')),
      false,
    );
  }
});

for (const [name, doc] of malformedDocs) {
  test(`module grammar rejects ${name} with a file and line diagnostic`, () => {
    const failures = messages(moduleStructureRule.check(moduleDocumentFixtures(doc)));
    assert.ok(failures.length > 0, name);
    assert.ok(failures.some((failure) => /^\.zcode\/modules\/sample\.md:[1-9][0-9]*:/.test(failure)));
  });
}

test('all compact list sections and required reference counts keep their minimums', () => {
  for (const section of ['参考', '边界', '规范']) {
    const doc = moduleDocumentText.replace(new RegExp('## ' + section + '\\n\\n[\\s\\S]*?(?=\\n\\n## |$)'), '## ' + section + '\n\n');
    assert.ok(messages(moduleStructureRule.check(moduleDocumentFixtures(doc))).length > 0, section);
  }
});

test('inline code keeps literal HTML notation as text', () => {
  const doc = moduleDocumentText.replace('- A 输入归领域。', '- A 输入归领域，源码标记为 `<h2>标题</h2>`。');
  assert.deepEqual(messages(moduleStructureRule.check(moduleDocumentFixtures(doc))), []);
});

test('the line limit accepts 300 physical lines and rejects 301', () => {
  const baseCount = moduleDocumentText.split('\n').length - 1;
  /** @param {number} count */
  const doc = (count) =>
    moduleDocumentText.replace(
      '1. 输入进入规则。\n2. 结果交付展示。',
      Array.from({ length: 2 + count - baseCount }, (_, index) => `${index + 1}. 输入进入规则。`).join('\n'),
    );
  assert.deepEqual(messages(moduleStructureRule.check(moduleDocumentFixtures(doc(300)))), []);
  assert.ok(messages(moduleStructureRule.check(moduleDocumentFixtures(doc(301)))).some((failure) => failure.includes('exceeds 300 lines')));
});
