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
