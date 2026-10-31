import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

import { collectArchitectureContext } from './context.mjs';
import { collectRepoPaths } from '../../shared/files.mjs';

test('repository collection exposes source roles and excludes controlled workspaces', async () => {
  const paths = await collectRepoPaths(process.cwd(), () => true, true);
  assert.equal(
    paths.some((file) => file.rel.startsWith('.audit-tools/')),
    false,
  );
  const files = await collectArchitectureContext(process.cwd());
  assert.equal(
    files.files.some((file) => file.rel.startsWith('.zcode/plans/')),
    false,
  );
  assert.equal(
    files.files.some((file) => file.rel.startsWith('src/')),
    true,
  );
  assert.equal(
    files.files.some((file) => file.rel.startsWith('src-tauri/src/')),
    true,
  );
  assert.equal(
    files.files.some((file) => file.rel.startsWith('.zcode/modules/')),
    true,
  );
});

test('repository collection reads each source once and all rules reuse the parsed facts', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-test-module-mocks',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { mock } from 'node:test';
    import { resolve } from 'node:path';
    import * as files from 'node:fs/promises';
    import ts from 'typescript';
    import * as vue from 'vue/compiler-sfc';
    const reads = new Map(), scripts = new Map(), components = new Map();
    const increment = (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1);
    mock.module('node:fs/promises', { namedExports: { ...files, readFile: async (...args) => {
      increment(reads, resolve(String(args[0])));
      return files.readFile(...args);
    } } });
    mock.module('typescript', { defaultExport: { ...ts, createSourceFile: (...args) => {
      increment(scripts, args[0]);
      return ts.createSourceFile(...args);
    } } });
    mock.module('vue/compiler-sfc', { namedExports: { parse: (...args) => {
      increment(components, args[1].filename);
      return vue.parse(...args);
    } } });
    const { collectArchitectureContext } = await import('./scripts/architecture/facts/context.mjs');
    const { checkArchitecture } = await import('./scripts/architecture/check.mjs');
    const context = await collectArchitectureContext(process.cwd());
    for (const file of context.files) {
      assert.equal(reads.get(resolve(file.path)), 1, file.rel + ' reads');
      assert.equal(scripts.get(file.rel) ?? 0, file.syntax.scripts.length, file.rel + ' script parses');
      assert.equal(components.get(file.rel) ?? 0, Number(file.rel.endsWith('.vue')), file.rel + ' component parses');
    }
    const before = [Array.from(reads), Array.from(scripts), Array.from(components)];
    checkArchitecture(context);
    assert.deepEqual([Array.from(reads), Array.from(scripts), Array.from(components)], before);
  `,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
