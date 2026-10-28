import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { writeFile, readFile, mkdir, symlink, access } from 'node:fs/promises';
import { TestWorkspace, reserveTestOutput } from './test-workspace.mjs';

test('concurrent runs own separate directories and exact filenames', async () => {
  const roots = await Promise.all(Array.from({ length: 32 }, () => TestWorkspace.create(tmpdir(), 'circinus-node-test')));
  try {
    assert.equal(new Set(roots.map((root) => root.root)).size, 32);
    await Promise.all(roots.map((root, index) => writeFile(root.path('notes.txt'), String(index))));
    for (const [index, root] of roots.entries()) assert.equal(await readFile(root.path('notes.txt'), 'utf8'), String(index));
  } finally {
    await Promise.all(roots.map((root) => root.close()));
  }
});

test('explicit output conflicts preserve the existing report', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'circinus-node-report');
  try {
    const output = await reserveTestOutput(root.path('run.json'));
    try {
      await output.handle.writeFile('first report', 'utf8');
      await assert.rejects(reserveTestOutput(output.path), { code: 'EEXIST' });
      assert.equal(await readFile(output.path, 'utf8'), 'first report');
    } finally {
      await output.handle.close();
    }
  } finally {
    await root.close();
  }
});

test('cleanup releases a junction while preserving its external target', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'circinus-node-link');
  const outside = await TestWorkspace.create(tmpdir(), 'circinus-node-outside');
  try {
    await mkdir(root.path('nested'));
    await writeFile(outside.path('kept.txt'), 'outside');
    await symlink(outside.root, root.path('nested/link'), 'junction');
    await root.close();
    assert.equal(await readFile(outside.path('kept.txt'), 'utf8'), 'outside');
    await assert.rejects(access(root.root), { code: 'ENOENT' });
  } finally {
    await root.close();
    await outside.close();
  }
});
