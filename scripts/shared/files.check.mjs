import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { collectRepoPaths, pairedSourcePaths } from './files.mjs';
import { TestWorkspace } from './test-workspace.mjs';

const execute = promisify(execFile);

test('test counterparts preserve language and directory identity', () => {
  assert.deepEqual(pairedSourcePaths('src/value.check.mjs'), ['src/value.mjs', 'src/value.vue', 'src/value.js']);
  assert.deepEqual(pairedSourcePaths('src/value.spec.ts'), ['src/value.ts', 'src/value.vue']);
  assert.deepEqual(pairedSourcePaths('src/value_tests.rs'), ['src/value.rs']);
  assert.deepEqual(pairedSourcePaths('src/value.ts'), []);
});

test('collection follows Git ignore semantics for tracked and untracked files across nested scopes', async () => {
  const work = await TestWorkspace.create(tmpdir(), 'pyxis-ignore-paths');
  try {
    await execute('git', ['init', '--quiet', work.root], { windowsHide: true });
    const names = [
      'tracked.log',
      'other.log',
      'keep.log',
      'nested/inherited.log',
      'nested/keep.log',
      'nested/hidden.ts',
      'nested/deep/hidden.ts',
      'nested/deep/kept.ts',
      'sibling/hidden.ts',
      'root-only.md',
      'nested/root-only.md',
      'cache/hidden.ts',
      'nested/cache/hidden.ts',
      'blocked/keep.ts',
      'generated/keep.ts',
      'generated/hidden.ts',
      'plain.ts',
      'space name.ts',
      '#literal.ts',
      '!literal.ts',
      'only-directory',
      '.cache/visible.md',
      'target/visible.rs',
      'dist/visible.ts',
      'release/visible.json',
      'src-tauri/gen/visible.ts',
      'node_modules/hidden.ts',
      '.zcode/plans/hidden.md',
    ];
    for (const name of names) {
      await mkdir(dirname(work.path(name)), { recursive: true });
      await writeFile(work.path(name), 'fixture', 'utf8');
    }
    await execute('git', ['-C', work.root, 'add', '--', 'tracked.log'], { windowsHide: true });
    await writeFile(
      work.path('.gitignore'),
      [
        '*.log',
        '!keep.log',
        '/root-only.md',
        'cache/',
        'blocked/',
        '!blocked/keep.ts',
        'generated/*',
        '!generated/keep.ts',
        String.raw`space\ name.ts`,
        String.raw`\#literal.ts`,
        String.raw`\!literal.ts`,
        'only-directory/',
        'node_modules/',
        '.zcode/plans/',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(work.path('nested/.gitignore'), '!inherited.log\n*.ts\n', 'utf8');
    await writeFile(work.path('nested/deep/.gitignore'), '!kept.ts\n', 'utf8');
    await mkdir(work.path('empty'));
    await mkdir(work.path('cache/empty'));
    const result = spawnSync('git', ['-C', work.root, 'check-ignore', '--no-index', '-z', '--stdin'], {
      windowsHide: true,
      encoding: 'utf8',
      input: names.join('\0') + '\0',
    });
    assert.equal(result.status, 0, result.stderr);
    const stdout = result.stdout;
    const ignored = new Set(stdout.split('\0').filter(Boolean));
    const paths = await collectRepoPaths(work.root, () => true, true);
    const actual = paths
      .filter(({ rel }) => !rel.endsWith('/'))
      .map(({ rel }) => rel)
      .sort();
    const expected = [...names.filter((name) => !ignored.has(name)), '.gitignore', 'nested/.gitignore', 'nested/deep/.gitignore'].sort();
    assert.deepEqual(actual, expected);
    assert.ok(paths.some(({ rel }) => rel === 'empty/'));
    assert.equal(
      paths.some(({ rel }) => rel.startsWith('cache/') || rel.startsWith('.git/')),
      false,
    );
    const sources = await collectRepoPaths(work.root, (_rel, extension) => extension === '.ts');
    assert.deepEqual(
      sources.map(({ rel }) => rel).sort(),
      expected.filter((name) => name.endsWith('.ts')),
    );
  } finally {
    await work.close();
  }
});

test('changed rules apply on the next collection', async () => {
  const work = await TestWorkspace.create(tmpdir(), 'pyxis-ignore-refresh');
  try {
    await mkdir(work.path('nested'));
    await writeFile(work.path('.gitignore'), 'first.ts\n', 'utf8');
    await writeFile(work.path('nested/.gitignore'), '!first.ts\n', 'utf8');
    for (const name of ['first.ts', 'second.ts', 'nested/first.ts']) await writeFile(work.path(name), 'fixture', 'utf8');
    const paths = await collectRepoPaths(work.root, (_rel, extension) => extension === '.ts');
    assert.deepEqual(paths.map(({ rel }) => rel).sort(), ['nested/first.ts', 'second.ts']);
    await writeFile(work.path('.gitignore'), 'second.ts\n', 'utf8');
    const refreshed = await collectRepoPaths(work.root, (_rel, extension) => extension === '.ts');
    assert.deepEqual(refreshed.map(({ rel }) => rel).sort(), ['first.ts', 'nested/first.ts']);
    assert.equal(await readFile(work.path('first.ts'), 'utf8'), 'fixture');
  } finally {
    await work.close();
  }
});

test('parallel collections read each ignore file once per walk', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-test-module-mocks',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import {mock} from 'node:test';
    import * as fs from 'node:fs/promises';
    const counts=new Map();
    mock.module('node:fs/promises',{namedExports:{...fs,readFile:async(path,...args)=>{
      const key=String(path);if(key.endsWith('.gitignore'))counts.set(key,(counts.get(key)||0)+1);
      return fs.readFile(path,...args);
    }}});
    const {collectRepoPaths}=await import('./scripts/shared/files.mjs');
    const [first,second]=await Promise.all([collectRepoPaths(process.cwd(),()=>true),collectRepoPaths(process.cwd(),()=>true)]);
    assert.deepEqual(first,second);
    assert.ok(counts.size>0);
    for(const [file,count] of counts)assert.equal(count,2,file);
  `,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
