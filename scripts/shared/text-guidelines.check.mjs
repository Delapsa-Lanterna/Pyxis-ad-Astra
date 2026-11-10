import assert from 'node:assert/strict';
import test from 'node:test';
import { checkTextGuidelines, isTextGuidelineFile } from './text-guidelines.mjs';

test('accepts spaced CJK and English text', () => {
  assert.deepEqual(checkTextGuidelines([{ rel: 'text.md', text: '这是 Text "内部文字"' }]), []);
});

test('accepts punctuation directly after a closing quote', () => {
  assert.deepEqual(checkTextGuidelines([{ rel: 'text.md', text: '这是 Text "内部文字"。' }]), []);
});

test('rejects Chinese punctuation', () => {
  const failures = checkTextGuidelines([{ rel: 'text.md', text: '这是“文字”' }]);
  assert.ok(failures.some((failure) => failure.includes('text.punctuation')));
});

test('rejects missing CJK and English spacing', () => {
  const failures = checkTextGuidelines([{ rel: 'text.md', text: '这是Text' }]);
  assert.ok(failures.some((failure) => failure.includes('text.cjk-latin-space')));
});

test('rejects missing external quote spacing', () => {
  const failures = checkTextGuidelines([{ rel: 'text.md', text: '这是"文字"' }]);
  assert.ok(failures.some((failure) => failure.includes('text.outer-space')));
});

test('accepts function-call notation in visible placeholders', () => {
  assert.deepEqual(checkTextGuidelines([{ rel: 'ColorPicker.vue', text: '<input placeholder="rgba(...)" />' }]), []);
});

test('ignores escaped line breaks in source strings', () => {
  assert.deepEqual(
    checkTextGuidelines([{ rel: 'editor.ts', text: 'const message = `槽位：${slotId}\\n装配 ID：${id}\\n来源：${source}`;' }]),
    [],
  );
});

test('preserves visible spacing around masked source syntax', () => {
  assert.deepEqual(
    checkTextGuidelines([
      { rel: 'README.md', text: '执行 `npm run build` (先检查)\n' },
      { rel: 'SpecProblems.vue', text: '<strong>{{ value }} ({{ count }})</strong>' },
    ]),
    [],
  );
});

test('does not scan test or script sources', () => {
  assert.equal(isTextGuidelineFile('src/app/example.spec.ts', '.ts'), false);
  assert.equal(isTextGuidelineFile('scripts/check-text-guidelines.mjs', '.mjs'), false);
  assert.equal(isTextGuidelineFile('src-tauri/src/test_support.rs', '.rs'), false);
});

test('excludes every test file family, helper directory and generated test report', () => {
  for (const rel of [
    'src/editor.spec.ts',
    'src/editor.test.vue',
    'src/__tests__/example.ts',
    'src/test/fixtures/example.ts',
    'src-tauri/src/editor_tests.rs',
    'src-tauri/src/editor_test.rs',
    'src-tauri/src/tests.rs',
    'src-tauri/src/test_support/example.rs',
    'src-tauri/testdata/example.json',
    '.vitest/json/output.json',
  ]) {
    assert.equal(isTextGuidelineFile(rel, rel.slice(rel.lastIndexOf('.'))), false, rel);
    assert.deepEqual(checkTextGuidelines([{ rel, text: 'const text = "测试Text“内容”";' }]), [], rel);
  }
});

test('excludes inline Rust tests and preserves production literal positions', () => {
  const text = [
    'pub fn before() { let _ = "生产Text"; }',
    '#[cfg(test)] mod tests { fn helper() { let _ = r#"测试Text“内容”{}"#; } }',
    '#[test] fn direct() { let _ = "测试Text“内容”"; }',
    '#[tokio::test] async fn asynchronous() { let _ = "测试Text“内容”"; }',
    'pub fn after() { let _ = "生产Text"; }',
  ].join('\n');
  const failures = checkTextGuidelines([{ rel: 'src/example.rs', text }]);
  assert.equal(failures.length, 2);
  assert.match(/** @type {string} */ (failures[0]), /^src\/example.rs:1:29 text.cjk-latin-space:/);
  assert.match(/** @type {string} */ (failures[1]), /^src\/example.rs:5:28 text.cjk-latin-space:/);
});

test('keeps Rust test-looking syntax inside production strings visible', () => {
  const text = 'pub fn visible() { let _ = r#"#[cfg(test)] mod tests { “文字” }"#; }';
  const failures = checkTextGuidelines([{ rel: 'src/example.rs', text }]);
  assert.equal(failures.filter((failure) => failure.includes('text.punctuation')).length, 2);
});
