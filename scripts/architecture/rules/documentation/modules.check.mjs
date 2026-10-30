import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';
import { architectureContext } from '../../facts/context.mjs';
import { collectArchitectureContext } from '../../facts/context.mjs';
import { moduleStructureRule } from './module-structure.mjs';
import { moduleOwnershipRule } from './module-ownership.mjs';
/** @param {import('../../facts/context.mjs').ArchitectureContext} context */
function moduleDiagnostics(context) {
  return [...moduleStructureRule.check(context), ...moduleOwnershipRule.check(context)];
}

const moduleRel = '.zcode/modules/sample.md';
const indexText = '# Module Map\n\n## 模块索引\n\n### 正式模块\n\n- [样例模块](modules/sample.md)：样例职责。\n';
const validDoc =
  '# 样例模块\n\n## 定义\n\n样例模块提供样例能力。\n\n## 参考\n\n' +
  '### 拥有\n\n- `assets/icon.png`：图标资源。\n- `src/domain/sample.ts`：领域规则。\n- `src/empty/`：空目录。\n\n' +
  '## 边界\n\n- A 输入归领域。\n- B 状态归会话。\n- C 资源归媒体。\n- D 编排归动作。\n- E 展示归组件。\n\n' +
  '## 链路\n\n### 加载\n\n1. 输入进入规则。\n2. 结果交付展示。\n\n### 释放\n\n1. 会话释放等待。\n\n' +
  '## 规范\n\n- A 输入必须绑定身份。\n- B 读取必须绑定票据。\n- C 状态必须归会话。\n- D 结果必须归消费者。\n- E 资源必须归媒体。\n';

function fixtures(doc = validDoc, map = indexText, extras = {}) {
  return architectureFixtures({
    '.zcode/module-map.md': map,
    [moduleRel]: doc,
    'src/domain/sample.ts': 'export const value = 1;',
    'assets/icon.png': '',
    'src/empty/': '',
    ...extras,
  });
}

test('canonical modules accept exact headings, compact lists, real files, empty directories and binary assets', () => {
  assert.deepEqual(messages(moduleDiagnostics(fixtures())), []);
});

test('module documents reject stylesheet references and style constraints', () => {
  for (const text of ['CSS 规则必须统一。', '共享样式位于 `src/styles/sample.css`。']) {
    const doc = validDoc.replace('样例模块提供样例能力。', text);
    assert.ok(messages(moduleDiagnostics(fixtures(doc))).some((failure) => failure.includes('must not contain CSS')));
  }
});

test('CRLF keeps the same structure and reference path order', () => {
  assert.deepEqual(messages(moduleDiagnostics(fixtures(validDoc.replace(/\n/g, '\r\n')))), []);
});

test('dictionary order applies only to reference paths while other sections retain reading order', () => {
  const doc = validDoc
    .replace('- A 输入归领域。\n- B 状态归会话。', '- B 状态归会话。\n- A 输入归领域。')
    .replace('- A 输入必须绑定身份。\n- B 读取必须绑定票据。', '- B 读取必须绑定票据。\n- A 输入必须绑定身份。')
    .replace(
      '### 加载\n\n1. 输入进入规则。\n2. 结果交付展示。\n\n### 释放\n\n1. 会话释放等待。',
      '### 释放\n\n1. 会话释放等待。\n\n### 加载\n\n1. 输入进入规则。\n2. 结果交付展示。',
    );
  assert.deepEqual(messages(moduleDiagnostics(fixtures(doc))), []);
});

for (const section of ['边界', '规范']) {
  test(`${section} rejects a repeated entry anywhere in its chosen reading order`, () => {
    const start = validDoc.indexOf('## ' + section + '\n\n');
    const doc = validDoc.slice(0, start) + validDoc.slice(start).replace(/(- A [^\n]+)(\n- B [^\n]+\n)- C [^\n]+/, '$1$2$1');
    const failures = moduleStructureRule.check(fixtures(doc));
    assert.equal(failures.length, 1);
    assert.ok(failures[0]);
    assert.equal(failures[0].message, `${section} entries must be unique`);
    assert.equal(failures[0].file, moduleRel);
    assert.equal(failures[0].column, 1);
  });
}

test('public declarations and shared directories remain outside module ownership, including paired tests', () => {
  const map = indexText.replace('## 模块索引', '## 公共文件\n\n- `src/domain/sample.ts`：共享规则。\n\n## 模块索引');
  const failures = messages(moduleDiagnostics(fixtures(validDoc, map)));
  assert.ok(failures.some((failure) => failure.includes('public file src/domain/sample.ts')));
  const consumed = validDoc
    .replace('- `src/domain/sample.ts`：领域规则。\n', '')
    .replace('## 边界', '### 消费\n\n- `src/domain/sample.ts`：共享规则。\n\n## 边界');
  assert.deepEqual(messages(moduleDiagnostics(fixtures(consumed, map))), []);
  for (const path of ['src/shared/value.ts', 'scripts/shared/value.mjs', 'src/domain/sample.spec.ts']) {
    const doc = validDoc.replace('- `src/domain/sample.ts`：领域规则。', '- `' + path + '`：公共能力。');
    assert.ok(
      messages(moduleDiagnostics(fixtures(doc, map, { [path]: '' }))).some((failure) => failure.includes('cannot have module ownership')),
    );
  }
  for (const declaration of [
    '- `missing.ts`：缺失。',
    '- `../sample.ts`：越界。',
    '- `src/domain/sample.ts`：A。\n- `src/domain/sample.ts`：B。',
  ]) {
    const invalid = map.replace('- `src/domain/sample.ts`：共享规则。', declaration);
    assert.ok(messages(moduleDiagnostics(fixtures(consumed, invalid))).length);
  }
});

test('reference groups express distinct roles with compact, independently sorted paths', () => {
  const doc = validDoc
    .replace(
      '- `src/domain/sample.ts`：领域规则。\n- `src/empty/`：空目录。',
      '### 消费\n\n- `src/domain/sample.ts`：消费唯一实例。\n\n### 装配\n\n- `src/empty/`：宿主入口。\n\n### 关联\n\n- `AGENTS.md`：项目约束。',
    )
    .replace('：图标资源。\n###', '：图标资源。\n\n###');
  assert.deepEqual(messages(moduleDiagnostics(fixtures(doc, indexText, { 'AGENTS.md': '' }))), []);
  for (const invalid of [
    doc.replace('### 消费', '### 装配'),
    doc.replace('### 消费', '### 关联').replace('### 关联\n\n- `AGENTS.md`', '### 消费\n\n- `AGENTS.md`'),
    doc.replace('- `src/domain/sample.ts`：消费唯一实例。', ''),
    doc.replace('`src/empty/`', '`assets/icon.png`'),
  ])
    assert.ok(messages(moduleDiagnostics(fixtures(invalid, indexText, { 'AGENTS.md': '' }))).length > 0);
});

test('colocated tests keep the corresponding production owner', () => {
  const map = indexText + '- [另一模块](modules/other.md)：其它职责。\n';
  const other = validDoc
    .replace('# 样例模块', '# 另一模块')
    .replace('### 拥有\n\n', '### 拥有\n\n- `src/domain/sample.spec.ts`：行为验证。\n\n### 消费\n\n');
  const failures = messages(
    moduleDiagnostics(
      fixtures(validDoc, map, {
        '.zcode/modules/other.md': other,
        'src/domain/sample.spec.ts': '',
      }),
    ),
  );
  assert.ok(failures.some((failure) => failure.includes('test ownership conflicts')));
  assert.equal(failures.length, 1);
});

test('owned directory descendants have one owner while consumption may be shared', () => {
  const second = validDoc.replace('# 样例模块', '# 另一模块').replace('### 拥有', '### 消费');
  const map = indexText + '- [另一模块](modules/other.md)：其它职责。\n';
  const extras = { '.zcode/modules/other.md': second, 'src/empty/child.ts': '' };
  assert.deepEqual(messages(moduleDiagnostics(fixtures(validDoc, map, extras))), []);
  for (const owned of [
    second.replace('### 消费', '### 拥有'),
    second.replace('### 消费', '### 拥有').replace('`src/empty/`', '`src/empty/child.ts`'),
  ])
    assert.ok(
      messages(moduleDiagnostics(fixtures(validDoc, map, { ...extras, '.zcode/modules/other.md': owned }))).some((failure) =>
        failure.includes('ownership of src/empty'),
      ),
    );
  const empty = second.replace('### 消费', '### 拥有');
  assert.ok(
    messages(moduleDiagnostics(fixtures(validDoc, map, { '.zcode/modules/other.md': empty }))).some((failure) =>
      failure.includes('ownership of src/empty'),
    ),
  );
});

const malformedDocs = [
  ['unknown H2', validDoc.replace('## 规范', '## 其它')],
  ['extra H2', validDoc + '\n## 陷阱\n\n- A 输入必须绑定身份。\n'],
  ['duplicate H2', validDoc.replace('## 规范', '## 边界\n\n## 规范')],
  ['reordered H2', validDoc.replace('## 边界', '## 规范').replace(/## 规范(?=\n\n- A 输入必须)/, '## 边界')],
  ['missing H2', validDoc.replace('## 规范\n\n', '')],
  ['closed H2', validDoc.replace('## 定义', '## 定义 ##')],
  ['content before 定义', validDoc.replace('## 定义', '额外内容\n\n## 定义')],
  ['extra H1', validDoc.replace('- A 输入归领域。', '# 额外标题')],
  ['H3 outside 参考 and 链路', validDoc.replace('- A 输入归领域。', '### 越界标题')],
  ['H4 inside 链路', validDoc.replace('### 加载', '#### 加载')],
  ['closed H3', validDoc.replace('### 加载', '### 加载 ###')],
  ['indented H3', validDoc.replace('### 加载', '  ### 加载')],
  ['empty H3', validDoc.replace('### 加载', '### ')],
  ['empty definition', validDoc.replace('样例模块提供样例能力。', '')],
  ['multiline definition', validDoc.replace('样例模块提供样例能力。', '第一行。\n第二行。')],
  ['definition list', validDoc.replace('样例模块提供样例能力。', '- 一行列表。')],
  ['definition table', validDoc.replace('样例模块提供样例能力。', '| 一行表格 |')],
  ['definition HTML', validDoc.replace('样例模块提供样例能力。', '<div>正文</div>')],
  ['inline HTML heading', validDoc.replace('样例模块提供样例能力。', '正文<h2>其它</h2>')],
  ['inline HTML comment', validDoc.replace('- A 输入归领域。', '- A 输入归领域。<!--额外内容-->')],
  ['inline image', validDoc.replace('- A 输入归领域。', '- A 输入归领域。![image](asset.png)')],
  ['definition heading', validDoc.replace('样例模块提供样例能力。', '### 单行标题')],
  ['paragraph in 边界', validDoc.replace('- A 输入归领域。', 'A 输入归领域。')],
  ['ordered list in 规范', validDoc.replace('- A 输入必须绑定身份。', '1. A 输入必须绑定身份。')],
  ['table in 规范', validDoc.replace('- A 输入必须绑定身份。', '| A | B |')],
  ['fence in 规范', validDoc.replace('- A 输入必须绑定身份。', '```js\nconst x = 1;\n```')],
  ['nested unordered list', validDoc.replace('- B 状态归会话。', '  - B 状态归会话。')],
  ['alternative unordered marker', validDoc.replace('- B 状态归会话。', '* B 状态归会话。')],
  ['loose unordered list', validDoc.replace('- B 状态归会话。', '\n- B 状态归会话。')],
  ['unordered continuation', validDoc.replace('- B 状态归会话。', '- B 状态归会话。\n  续行。')],
  ['duplicate unordered entry', validDoc.replace('- B 状态归会话。', '- A 输入归领域。')],
  ['chain without H3', validDoc.replace('### 加载\n\n', '')],
  ['empty chain', validDoc.replace('1. 输入进入规则。\n2. 结果交付展示。', '')],
  ['chain paragraph', validDoc.replace('1. 输入进入规则。', '输入进入规则。')],
  ['chain unordered list', validDoc.replace('1. 输入进入规则。', '- 输入进入规则。')],
  ['loose chain list', validDoc.replace('2. 结果交付展示。', '\n2. 结果交付展示。')],
  ['chain numbering gap', validDoc.replace('2. 结果交付展示。', '3. 结果交付展示。')],
  ['chain numbering starts at two', validDoc.replace('1. 会话释放等待。', '2. 会话释放等待。')],
  ['chain numbering leading zero', validDoc.replace('1. 会话释放等待。', '01. 会话释放等待。')],
  ['nested chain step', validDoc.replace('2. 结果交付展示。', '  2. 结果交付展示。')],
  ['alternative ordered delimiter', validDoc.replace('2. 结果交付展示。', '2) 结果交付展示。')],
  ['duplicate chain title', validDoc.replace('### 释放', '### 加载')],
  ['extra paragraph after chain', validDoc.replace('## 规范', '额外正文\n\n## 规范')],
  ['missing heading separator', validDoc.replace('## 定义\n\n', '## 定义\n')],
  ['extra blank line', validDoc.replace('## 定义\n\n', '## 定义\n\n\n')],
  ['trailing whitespace', validDoc.replace('样例模块提供样例能力。', '样例模块提供样例能力。 ')],
  ['missing final newline', validDoc.trimEnd()],
  ['extra final blank', validDoc + '\n'],
  ['reference nested bullet', validDoc.replace('`assets/icon.png`', '- `assets/icon.png`')],
  ['reference missing group', validDoc.replace('### 拥有\n\n', '')],
  ['reference unknown group', validDoc.replace('### 拥有', '### 其它')],
  ['reference missing marker', validDoc.replace('- `assets/icon.png`', '`assets/icon.png`')],
  ['reference missing colon', validDoc.replace('`assets/icon.png`：', '`assets/icon.png` ')],
  ['reference ASCII colon', validDoc.replace('`assets/icon.png`：', '`assets/icon.png`:')],
  ['reference missing remark', validDoc.replace('`assets/icon.png`：图标资源。', '`assets/icon.png`：')],
  ['reference multiple paths', validDoc.replace('`assets/icon.png`', '`assets/icon.png`、`src/domain/sample.ts`')],
  ['reference symbol suffix', validDoc.replace('`src/domain/sample.ts`', '`src/domain/sample.ts:value`')],
  ['reference glob', validDoc.replace('`src/domain/sample.ts`', '`src/domain/*.ts`')],
  ['reference traversal', validDoc.replace('`src/domain/sample.ts`', '`src/../domain/sample.ts`')],
  ['reference backslash', validDoc.replace('`src/domain/sample.ts`', '`src\\domain\\sample.ts`')],
  ['reference absolute path', validDoc.replace('`src/domain/sample.ts`', '`/src/domain/sample.ts`')],
  ['reference missing file', validDoc.replace('`assets/icon.png`', '`assets/missing.png`')],
  ['reference missing directory', validDoc.replace('`src/empty/`', '`src/missing/`')],
  ['reference loose lines', validDoc.replace('`src/domain/sample.ts`', '\n`src/domain/sample.ts`')],
  [
    'reference dictionary order',
    validDoc.replace(
      '- `assets/icon.png`：图标资源。\n- `src/domain/sample.ts`：领域规则。',
      '- `src/domain/sample.ts`：领域规则。\n- `assets/icon.png`：图标资源。',
    ),
  ],
  ['reference duplicate path', validDoc.replace('`src/domain/sample.ts`', '`assets/icon.png`')],
  ['reference directory aliases', validDoc.replace('`src/empty/`：空目录。', '`src/empty`：空目录。\n- `src/empty/`：重复目录。')],
  ['title mismatch', validDoc.replace('# 样例模块', '# 其它模块')],
  ['line limit', validDoc.replace('样例模块提供样例能力。', Array.from({ length: 301 }, () => '正文。').join('\n'))],
];

for (const [name, doc] of malformedDocs) {
  test(`module grammar rejects ${name} with a file and line diagnostic`, () => {
    const failures = messages(moduleDiagnostics(fixtures(doc)));
    assert.ok(failures.length > 0, name);
    assert.ok(failures.some((failure) => /^\.zcode\/modules\/sample\.md:[1-9][0-9]*:/.test(failure)));
  });
}

test('all compact list sections and required reference counts keep their minimums', () => {
  for (const section of ['参考', '边界', '规范']) {
    const doc = validDoc.replace(new RegExp('## ' + section + '\\n\\n[\\s\\S]*?(?=\\n\\n## |$)'), '## ' + section + '\n\n');
    assert.ok(messages(moduleDiagnostics(fixtures(doc))).length > 0, section);
  }
});

test('inline code keeps literal HTML notation as text', () => {
  const doc = validDoc.replace('- A 输入归领域。', '- A 输入归领域，源码标记为 `<h2>标题</h2>`。');
  assert.deepEqual(messages(moduleDiagnostics(fixtures(doc))), []);
});

test('the line limit accepts 300 physical lines and rejects 301', () => {
  const baseCount = validDoc.split('\n').length - 1;
  /** @param {number} count */
  const doc = (count) =>
    validDoc.replace(
      '1. 输入进入规则。\n2. 结果交付展示。',
      Array.from({ length: 2 + count - baseCount }, (_, index) => `${index + 1}. 输入进入规则。`).join('\n'),
    );
  assert.deepEqual(messages(moduleDiagnostics(fixtures(doc(300)))), []);
  assert.ok(messages(moduleDiagnostics(fixtures(doc(301)))).some((failure) => failure.includes('exceeds 300 lines')));
});

test('module map and physical documents form a one-to-one correspondence', () => {
  /** @type {Array<[string, string, Record<string, string>]>} */
  const variants = [
    [validDoc, indexText + '- [重复](modules/sample.md)：重复。\n', {}],
    [validDoc, indexText.replace('sample.md', 'missing.md'), {}],
    [validDoc, indexText, { '.zcode/modules/extra.md': validDoc }],
    [validDoc, indexText, { '.zcode/modules/notes.txt': '正文' }],
    [validDoc, indexText, { '.zcode/modules/nested/': '' }],
    [validDoc, indexText, { '.zcode/modules/nested/sample.md': validDoc }],
    [validDoc, indexText.replace('sample.md', 'Bad_Name.md'), {}],
    [validDoc, indexText.replace('### 正式模块', '### 其它'), {}],
    [validDoc, indexText.replace('### 正式模块\n\n', '### 正式模块\n\n\n'), {}],
    [validDoc, indexText.replace('### 正式模块', '### 正式模块\n\n### 正式模块'), {}],
    [validDoc, indexText.replace('- [样例模块]', '正文\n- [样例模块]'), {}],
    [
      validDoc,
      indexText + '\n- [额外](modules/extra.md)：职责。\n',
      { '.zcode/modules/extra.md': validDoc.replace('# 样例模块', '# 额外') },
    ],
    [validDoc, indexText + '### 其它\n\n- [重复](modules/sample.md)：职责。\n', {}],
    [validDoc, indexText + '- [样例模块](modules/extra.md)：职责。\n', { '.zcode/modules/extra.md': validDoc }],
  ];
  for (const [doc, map, extras] of variants) assert.ok(messages(moduleDiagnostics(fixtures(doc, map, extras))).length > 0);
  assert.ok(messages(moduleDiagnostics(architectureFixtures({}))).length > 0);
});

test('the shared collector supplies real module, source, binary and directory identities to the rule', async () => {
  const files = await collectArchitectureContext(process.cwd());
  const inventory = files.paths;
  assert.ok(inventory.has('src-tauri/icons/'));
  assert.ok(inventory.has('src-tauri/icons/icon.ico'));
  assert.deepEqual(messages(moduleDiagnostics(files)), []);
});

test('browser facilities have one test owner while formal sources and shared helpers retain their boundaries', async () => {
  const context = await collectArchitectureContext(process.cwd());
  const document = context.byPath.get('.zcode/modules/browser-testing.md');
  assert.ok(document);
  const owned = document.document.references.filter(({ group }) => group === '拥有').map(({ path }) => path);
  assert.deepEqual(owned, ['scripts/browser/', 'src/test/browser/']);
  for (const path of [...context.paths].filter((path) => !path.endsWith('/') && owned.some((root) => path.startsWith(root)))) {
    assert.equal(context.moduleMap.shared.has(path), false);
    const owners = context.documents.filter((file) =>
      file.document.references.some(
        (reference) => reference.group === '拥有' && context.moduleMap.descendants.get(reference.path.replace(/\/$/, ''))?.includes(path),
      ),
    );
    assert.deepEqual(
      owners.map(({ rel }) => rel),
      [document.rel],
    );
  }
  for (const path of [
    'src/test/fixtures/settings.ts',
    'src/test/unit/mount-setup.ts',
    'src/test/test-foundations.spec.ts',
    'scripts/shared/sample-statistics.mjs',
  ])
    assert.equal(context.moduleMap.shared.has(path), true);
  assert.equal(
    context.frontend.some(({ rel }) => rel === 'src/test/browser/cases/csv-desktop.ts'),
    false,
  );
  assert.ok(context.frontend.some(({ rel }) => rel === 'src/app/App.vue'));
  assert.equal(context.paths.has('src/app/components/csv-editor/csv-rendering.browser.ts'), false);
  assert.equal(context.paths.has('scripts/performance/csv-rendering.mjs'), false);
  const monitor = context.byPath.get('.zcode/modules/performance-monitor.md');
  assert.ok(monitor);
  assert.equal(
    monitor.document.references.some(({ path }) => path.includes('browser/') || path.endsWith('performance_retained_tests.rs')),
    false,
  );
});

test('reference existence consumes the complete repository inventory rather than only parsed source files', () => {
  const sourceFiles = fixtures().files.filter((file) => file.rel !== 'assets/icon.png' && file.rel !== 'src/empty/');
  const inventory = [...sourceFiles.map((file) => file.rel), 'assets/icon.png', 'src/empty/'];
  assert.deepEqual(messages(moduleDiagnostics(architectureContext(sourceFiles, inventory))), []);
  assert.ok(
    messages(
      moduleDiagnostics(
        architectureContext(
          sourceFiles,
          inventory.filter((path) => path !== 'src/empty/'),
        ),
      ),
    ).length > 0,
  );
});
