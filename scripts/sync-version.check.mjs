import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TestWorkspace } from './shared/test-workspace.mjs';

const script = fileURLToPath(new URL('./sync-version.mjs', import.meta.url));
const fixtures = new Map([
  ['package.json', '{"version":"7.8.9"}\n'],
  ['package-lock.json', '{"version":"1.2.3","packages":{"":{"version":"1.2.3"},"node_modules/example":{"version":"1.2.3"}}}\n'],
  ['src-tauri/Cargo.toml', '[package]\nname = "pyxis-ad-astra"\nversion = "1.2.3"\n[dependencies]\nexample = "1.2.3"\n'],
  ['src-tauri/Cargo.lock', '[[package]]\nname = "example"\nversion = "1.2.3"\n[[package]]\nname = "pyxis-ad-astra"\nversion = "1.2.3"\n'],
]);

for (const dryRun of [true, false]) {
  test(`version synchronization ${dryRun ? 'previews changes' : 'updates all targets once'}`, async () => {
    const workspace = await TestWorkspace.create(tmpdir(), 'pyxis-version');
    try {
      await mkdir(workspace.path('src-tauri'));
      for (const [path, content] of fixtures) await writeFile(workspace.path(path), content, 'utf8');
      const result = spawnSync(process.execPath, [script, ...(dryRun ? ['--dry-run'] : [])], { cwd: workspace.root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /3 file\(s\)/);
      assert.equal(await readFile(workspace.path('package.json'), 'utf8'), fixtures.get('package.json'));
      if (dryRun) {
        for (const [path, content] of fixtures) assert.equal(await readFile(workspace.path(path), 'utf8'), content);
      } else {
        const lock = JSON.parse(await readFile(workspace.path('package-lock.json'), 'utf8'));
        assert.equal(lock.version, '7.8.9');
        assert.equal(lock.packages[''].version, '7.8.9');
        assert.equal(lock.packages['node_modules/example'].version, '1.2.3');
        assert.equal(
          await readFile(workspace.path('src-tauri/Cargo.toml'), 'utf8'),
          '[package]\nname = "pyxis-ad-astra"\nversion = "7.8.9"\n[dependencies]\nexample = "1.2.3"\n',
        );
        assert.equal(
          await readFile(workspace.path('src-tauri/Cargo.lock'), 'utf8'),
          '[[package]]\nname = "example"\nversion = "1.2.3"\n[[package]]\nname = "pyxis-ad-astra"\nversion = "7.8.9"\n',
        );
        const paths = [...fixtures.keys()];
        const before = await Promise.all(paths.map((path) => stat(workspace.path(path))));
        const repeated = spawnSync(process.execPath, [script], { cwd: workspace.root, encoding: 'utf8' });
        assert.equal(repeated.status, 0, repeated.stderr);
        assert.match(repeated.stdout, /0 file\(s\)/);
        const after = await Promise.all(paths.map((path) => stat(workspace.path(path))));
        assert.deepEqual(
          after.map((entry) => entry.mtimeMs),
          before.map((entry) => entry.mtimeMs),
        );
      }
    } finally {
      await workspace.close();
    }
  });
}

test('an unreadable target reports failure before writing version records', async () => {
  const workspace = await TestWorkspace.create(tmpdir(), 'pyxis-version-failure');
  try {
    await mkdir(workspace.path('src-tauri'));
    for (const [path, content] of fixtures) if (path !== 'src-tauri/Cargo.lock') await writeFile(workspace.path(path), content, 'utf8');
    const result = spawnSync(process.execPath, [script], { cwd: workspace.root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOENT/);
    for (const path of ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml'])
      assert.equal(await readFile(workspace.path(path), 'utf8'), fixtures.get(path));
  } finally {
    await workspace.close();
  }
});

test('npm version runs the configured synchronization hook', async () => {
  const workspace = await TestWorkspace.create(tmpdir(), 'pyxis-npm-version');
  try {
    await mkdir(workspace.path('src-tauri'));
    await mkdir(workspace.path('scripts'));
    for (const [path, content] of fixtures) await writeFile(workspace.path(path), content, 'utf8');
    await writeFile(workspace.path('scripts/sync-version.mjs'), await readFile(script, 'utf8'), 'utf8');
    const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    await writeFile(workspace.path('package.json'), JSON.stringify({ version: '7.8.9', scripts: { version: scripts.version } }), 'utf8');
    const result = spawnSync(
      process.platform === 'win32' ? 'cmd.exe' : 'npm',
      process.platform === 'win32'
        ? ['/d', '/s', '/c', 'npm.cmd version 7.8.10 --no-git-tag-version']
        : ['version', '7.8.10', '--no-git-tag-version'],
      { cwd: workspace.root, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(await readFile(workspace.path('package-lock.json'), 'utf8')).version, '7.8.10');
    for (const path of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'])
      assert.match(await readFile(workspace.path(path), 'utf8'), /name = "pyxis-ad-astra"\nversion = "7\.8\.10"/);
  } finally {
    await workspace.close();
  }
});
