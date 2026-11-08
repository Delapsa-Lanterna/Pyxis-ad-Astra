import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFrontendSource, sourceChecker } from './frontend-source.mjs';

test('runtime aliases assigned after declaration retain their imported call target', () => {
  const rel = 'src/app/sample.ts';
  const text = "import { saveCsvPatch } from '@/services/csv-table.service'; let submit; submit = saveCsvPatch; submit();";
  const file = parseFrontendSource({ path: rel, rel, text });
  assert.equal(
    file.calls.some((call) => call.localName === 'saveCsvPatch'),
    true,
  );
});

test('semantic consumers reuse the same checker for an already parsed script', () => {
  const source = parseFrontendSource({ path: 'sample.ts', rel: 'sample.ts', text: 'const value=1; export const alias=value;' });
  const ast = source.syntax.scripts[0]?.ast;
  assert.ok(ast);
  assert.equal(sourceChecker(ast), sourceChecker(ast));
});
