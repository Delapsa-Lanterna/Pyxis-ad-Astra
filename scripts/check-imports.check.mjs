import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkInlineTypeImports } from './check-imports.mjs';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TestWorkspace } from './shared/test-workspace.mjs';

for (const rel of ['src/domain/sample.ts', 'src/app/Sample.vue', 'src/test/sample.spec.ts', 'scripts/sample.ts']) {
  test('inline type imports report their exact source position in ' + rel, () => {
    const body = "type A = import('module').Value;\ntype B = typeof import('module');";
    const text = rel.endsWith('.vue') ? '<template><div /></template>\n<script setup lang="ts">\n' + body + '\n</script>' : '\n' + body;
    const diagnostics = checkInlineTypeImports({ path: rel, rel, text });
    assert.equal(diagnostics.length, 2);
    for (const [index, diagnostic] of diagnostics.entries()) {
      assert.equal(diagnostic.ruleId, 'inline-type-import');
      assert.equal(diagnostic.file, rel);
      assert.equal(diagnostic.line, (rel.endsWith('.vue') ? 3 : 2) + index);
      assert.equal(diagnostic.column, 10);
      assert.equal(diagnostic.expected, 'top-level import type');
      assert.equal(diagnostic.symbol, index ? "typeof import('module')" : "import('module').Value");
    }
  });
}

test('type imports nested in generics, queries, conditional types and declarations are checked', () => {
  const text = [
    "type A = Promise<import('module').Value[]>;",
    "type B = ReturnType<typeof import('module').create>;",
    "type C<T> = T extends import('module').Value ? import('module').Other : never;",
    "declare function load(): import('module').Value;",
  ].join('\n');
  assert.equal(checkInlineTypeImports({ path: 'sample.d.ts', rel: 'sample.d.ts', text }).length, 5);
});

test('top-level type imports, runtime imports, JSDoc and diagnostic samples retain their meanings', () => {
  const text = [
    "import type { Value } from 'module';",
    "import type * as Module from 'module';",
    'type A = Promise<Value[]>; type B = typeof Module;',
    "/** @param {import('module').Value} value */",
    "export async function load(value: Value) { return import('module'); }",
    'const example = "type A = import(\'module\').Value";',
    "// type A = import('module').Value;",
  ].join('\n');
  assert.deepEqual(checkInlineTypeImports({ path: 'sample.ts', rel: 'sample.ts', text }), []);
  assert.deepEqual(
    checkInlineTypeImports({ path: 'sample.mjs', rel: 'sample.mjs', text: "/** @type {import('module').Value} */ const value = {};" }),
    [],
  );
});

test('the executable rejects inline types and accepts JSDoc after the source is corrected', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'pyxis-import-check');
  const command = fileURLToPath(new URL('./check-imports.mjs', import.meta.url));
  try {
    await writeFile(root.path('sample.spec.ts'), "type Value = import('module').Value;", 'utf8');
    await writeFile(root.path('script.mjs'), "/** @type {import('module').Value} */ const value = {};", 'utf8');
    const invalid = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /sample.spec.ts:1:14: \[inline-type-import\]/);
    await writeFile(root.path('sample.spec.ts'), "import type { Value } from 'module';", 'utf8');
    const valid = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(valid.status, 0);
    assert.match(valid.stdout, /Inline type import check passed/);
  } finally {
    await root.close();
  }
});
