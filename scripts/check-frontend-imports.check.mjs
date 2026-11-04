import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkInlineTypeImports, checkMockSources } from './check-frontend-imports.mjs';

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
      assert.equal(diagnostic.source, 'scripts/check-frontend-imports.mjs');
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

test('string mock sources use the runtime resolver and retain original locations', async () => {
  const text =
    "import {vi as tools} from 'vitest';\ntools.mock('@/app/App.vue'); tools.doMock('vitest'); tools.mock('node:fs');\ntools['mock']('./missing');\nfunction local(tools) { tools.mock('./ignored'); }";
  const diagnostics = await checkMockSources([{ path: resolve('src/probe.spec.ts'), rel: 'src/probe.spec.ts', text }], process.cwd());
  assert.deepEqual(diagnostics, [
    {
      ruleId: 'mock-module-source',
      file: 'src/probe.spec.ts',
      line: 3,
      column: 1,
      message: 'mock source must resolve to an existing module',
      target: './missing',
      symbol: './missing',
      expected: 'existing module',
      reference: '.zcode/frontend-guidelines.md#测试',
      source: 'scripts/check-frontend-imports.mjs',
    },
  ]);
  assert.equal(
    (
      await checkMockSources(
        [{ path: 'sample.ts', rel: 'sample.ts', text: "const tools={mock(){}};tools.mock('./ignored');" }],
        process.cwd(),
      )
    ).length,
    0,
  );
});

for (const [body, failures] of [
  ['vi.fn<(...args:Parameters<typeof source>)=>unknown>();', 1],
  ['const tools=vi;tools.fn<(...args:Parameters<typeof source>)=>unknown>();', 1],
  ['vi.fn<typeof source>();', 0],
  ['vi.fn<(value:string)=>unknown>();', 0],
  ['vi.fn<(...args:Parameters<typeof source>)=>ReturnType<typeof source>>();', 0],
])
  test('function return contracts: ' + body, async () => {
    const [report] = await new ESLint().lintText("import {vi} from 'vitest';export declare function source(value:string):number;" + body, {
      filePath: resolve('src/domain/mock-signature.spec.ts'),
    });
    assert.ok(report);
    assert.equal(report.messages.length, failures);
    for (const row of report.messages) {
      assert.equal(row.ruleId, 'no-restricted-syntax');
      assert.equal(row.line, 1);
    }
  });
