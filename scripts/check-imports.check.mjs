import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TestWorkspace } from './shared/test-workspace.mjs';

test('check-imports dispatches frontend and Rust checks through one command', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'pyxis-import-check');
  const command = fileURLToPath(new URL('./check-imports.mjs', import.meta.url));
  try {
    await writeFile(root.path('sample.spec.ts'), "type Value = import('module').Value;", 'utf8');
    await writeFile(root.path('sample.rs'), 'fn inspect() { crate::catalog::read(); }', 'utf8');
    const invalid = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /sample.spec.ts:1:14: \[inline-type-import\]/);
    assert.match(invalid.stderr, /sample.rs:1:16: \[rust-inline-path\]/);

    await writeFile(root.path('sample.spec.ts'), "import type { Value } from 'module';", 'utf8');
    await writeFile(root.path('sample.rs'), 'use crate::catalog; fn inspect() { catalog::read(); }', 'utf8');
    const valid = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(valid.status, 0);
    assert.match(valid.stdout, /Import check passed/);
  } finally {
    await root.close();
  }
});
