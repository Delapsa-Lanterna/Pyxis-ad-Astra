import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TestWorkspace } from './shared/test-workspace.mjs';

test('style command separates showcase assets from application styles', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'pyxis-style-check');
  const command = fileURLToPath(new URL('./check-styles.mjs', import.meta.url));
  try {
    await mkdir(root.path('showcase'));
    await writeFile(root.path('showcase/index.html'), '<style>body{font-family:Arial}</style>', 'utf8');
    await writeFile(root.path('showcase/style.css'), 'body{font-family:Arial;display:invalid}', 'utf8');
    await writeFile(root.path('index.html'), '<input><br>', 'utf8');
    const valid = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout.trim(), 'CSS check passed.');
    await writeFile(root.path('index.html'), '<main style="display:block"></main>', 'utf8');
    const invalid = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /index.html:1:7: css.entry:/);
  } finally {
    await root.close();
  }
});
