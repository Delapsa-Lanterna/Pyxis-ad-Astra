import { test } from 'node:test';
import { moduleDocumentText, messages, moduleDocumentFixtures, moduleIndexText } from '../../testing/fixtures.mjs';
import assert from 'node:assert/strict';
import { moduleOwnershipRule } from './module-ownership.mjs';

test('module documents reject stylesheet references and style constraints', () => {
  for (const text of ['CSS 规则必须统一。', '共享样式位于 `src/styles/sample.css`。']) {
    const doc = moduleDocumentText.replace('样例模块提供样例能力。', text);
    assert.ok(messages(moduleOwnershipRule.check(moduleDocumentFixtures(doc))).some((failure) => failure.includes('must not contain CSS')));
  }
});

test('ownership inference retains the corresponding production owner independently of document grammar', () => {
  const map = moduleIndexText + '- [另一模块](modules/other.md)：其它职责。\n';
  const other = moduleDocumentText
    .replace('# 样例模块', '# 另一模块')
    .replace('### 拥有\n\n', '### 拥有\n\n- `src/domain/sample.spec.ts`：行为验证。\n\n### 消费\n\n');
  const failures = messages(
    moduleOwnershipRule.check(
      moduleDocumentFixtures(moduleDocumentText, map, {
        '.zcode/modules/other.md': other,
        'src/domain/sample.spec.ts': '',
      }),
    ),
  );
  assert.ok(failures.some((failure) => failure.includes('test ownership conflicts')));
  assert.equal(failures.length, 1);
});

test('owned directory descendants have one owner while consumption may be shared', () => {
  const second = moduleDocumentText.replace('# 样例模块', '# 另一模块').replace('### 拥有', '### 消费');
  const map = moduleIndexText + '- [另一模块](modules/other.md)：其它职责。\n';
  const extras = { '.zcode/modules/other.md': second, 'src/empty/child.ts': '' };
  assert.deepEqual(messages(moduleOwnershipRule.check(moduleDocumentFixtures(moduleDocumentText, map, extras))), []);
  for (const owned of [
    second.replace('### 消费', '### 拥有'),
    second.replace('### 消费', '### 拥有').replace('`src/empty/`', '`src/empty/child.ts`'),
  ])
    assert.ok(
      messages(
        moduleOwnershipRule.check(moduleDocumentFixtures(moduleDocumentText, map, { ...extras, '.zcode/modules/other.md': owned })),
      ).some((failure) => failure.includes('ownership of src/empty')),
    );
  const empty = second.replace('### 消费', '### 拥有');
  assert.ok(
    messages(moduleOwnershipRule.check(moduleDocumentFixtures(moduleDocumentText, map, { '.zcode/modules/other.md': empty }))).some(
      (failure) => failure.includes('ownership of src/empty'),
    ),
  );
});

test('production inventory requires ownership and colocated tests inherit their implementation', () => {
  const context = moduleDocumentFixtures(undefined, undefined, {
    'src/domain/unassigned.ts': 'export const value = 1;',
    'src/domain/sample.spec.ts': '',
  });
  assert.equal(context.moduleMap.owners.get('src/domain/sample.spec.ts'), '.zcode/modules/sample.md');
  const diagnostics = moduleOwnershipRule.check(context);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.file, 'src/domain/unassigned.ts');
  assert.equal(diagnostics[0]?.expected, 'module ownership or public registration');
});
