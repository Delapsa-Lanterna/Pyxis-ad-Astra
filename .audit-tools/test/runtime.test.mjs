import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collect, assertUnchanged } from '../src/collect.mjs';
import {
  cleanReports,
  cleanRuntime,
  execute,
  lock,
  ownedPath,
  publish,
  projectRoot,
  runtimeRoot,
  serve,
  setupCommands,
  toolRoot,
} from '../src/runtime.mjs';
import { scan } from '../src/scan.mjs';
import { serveReport } from './report-server.mjs';

async function fixture() {
  await mkdir(join(runtimeRoot, 'work'), { recursive: true });
  return mkdtemp(join(runtimeRoot, 'work/lifecycle '));
}

test('publication swaps only a complete result, removes prior success and preserves current on failure', async () => {
  const root = await fixture();
  try {
    const output = join(root, 'output');
    for (const id of ['first', 'second']) {
      await mkdir(join(root, id));
      await writeFile(join(root, id, 'index.html'), id);
    }
    await publish(output, 'first', join(root, 'first'));
    await assert.rejects(publish(output, 'failed', join(root, 'missing')), /ENOENT/);
    assert.deepEqual(JSON.parse(await readFile(join(output, 'current.json'), 'utf8')), { id: 'first' });
    await publish(output, 'second', join(root, 'second'));
    assert.equal(existsSync(join(output, 'first')), false);
    assert.equal(await readFile(join(output, 'second/index.html'), 'utf8'), 'second');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('read-only report server follows current publication and confines paths', async () => {
  const root = await fixture();
  /** @type {Awaited<ReturnType<typeof serve>> | undefined} */
  let server;
  try {
    await mkdir(join(root, 'job'));
    await writeFile(join(root, 'job/index.html'), '<h1>中文 report</h1>');
    await publish(join(root, 'output'), 'ready', join(root, 'job'));
    server = await serveReport(join(root, 'output'), 0);
    const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
    assert.ok((await (await fetch(base)).text()).includes('架构关系审计'));
    assert.equal(await (await fetch(base + '/index.html')).text(), '<h1>中文 report</h1>');
    assert.equal((await fetch(base + '/%2e%2e%2f%2e%2e%2fsecrets')).status, 404);
  } finally {
    if (server) {
      const active = server;
      await new Promise((done) => active.close(done));
    }
    await rm(root, { recursive: true });
  }
});

test('report fixtures release Fetch-restricted ephemeral ports before serving clients', async () => {
  const root = await fixture();
  let released = false;
  let calls = 0;
  const server = await serveReport(root, 0, {}, async (...args) => {
    if (calls++ === 0) {
      const unavailable = createServer();
      unavailable.address = () => ({ port: 6667, address: '127.0.0.1', family: 'IPv4' });
      unavailable.close = (done) => {
        released = true;
        done?.();
        return unavailable;
      };
      return unavailable;
    }
    return serve(...args);
  });
  try {
    assert.equal(released, true);
    assert.ok(calls >= 2);
    assert.equal((await fetch(`http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/`)).status, 200);
  } finally {
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true });
  }
});

test('operation lock excludes simultaneous ownership and owned cleanup excludes parent paths', async () => {
  const root = await fixture();
  try {
    const release = await lock(root, 'test');
    await assert.rejects(lock(root, 'other'), /owns/);
    await release();
    const second = await lock(root, 'next');
    await second();
    assert.throws(() => ownedPath(root, root), /Outside/);
    assert.throws(() => ownedPath(root, join(root, '../other')), /Outside/);
    const targets = await cleanRuntime(true);
    assert.deepEqual(
      targets.map((path) => path.slice(runtimeRoot.length + 1)),
      ['cache', 'build', 'work'],
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test('report cleanup previews then deletes individual files, retains directories and shares the operation lock', async () => {
  const root = await fixture();
  const storage = { runtimeRoot: join(root, 'runtime'), outputRoot: join(root, 'output') };
  try {
    await mkdir(join(storage.outputRoot, 'scan'), { recursive: true });
    await mkdir(storage.runtimeRoot);
    await writeFile(join(storage.outputRoot, 'scan/facts.json'), '{}');
    await writeFile(join(storage.runtimeRoot, 'last-run.json'), '{}');
    await writeFile(join(root, 'source.mjs'), 'source');
    assert.deepEqual(await cleanReports(true, storage), { dryRun: true, files: 2, bytes: 4 });
    assert.equal(await readFile(join(storage.outputRoot, 'scan/facts.json'), 'utf8'), '{}');
    const release = await lock(storage.runtimeRoot, 'scan');
    await assert.rejects(cleanReports(false, storage), /owns/);
    await release();
    assert.deepEqual(await cleanReports(false, storage), { dryRun: false, files: 2, bytes: 4 });
    assert.deepEqual(await readdir(join(storage.outputRoot, 'scan')), []);
    assert.equal(await readFile(join(root, 'source.mjs'), 'utf8'), 'source');
    assert.equal(existsSync(join(storage.runtimeRoot, 'last-run.json')), false);
    assert.deepEqual(await cleanReports(false, storage), { dryRun: false, files: 0, bytes: 0 });
  } finally {
    await rm(root, { recursive: true });
  }
});

test('collection includes untracked maintained files and excludes ignored runtime and plans', async () => {
  const root = await fixture();
  try {
    await execute('git', ['init', '--quiet'], { cwd: root });
    await mkdir(join(root, '.audit-tools'));
    await mkdir(join(root, '.zcode/plans'), { recursive: true });
    await Promise.all([
      writeFile(join(root, 'current.ts'), 'export const current = 1;'),
      writeFile(join(root, 'empty.txt'), ''),
      writeFile(join(root, '.audit-tools/hidden.ts'), 'tool'),
      writeFile(join(root, '.zcode/plans/record.md'), 'record'),
    ]);
    await execute(
      'git',
      ['-c', 'user.name=Audit Fixture', '-c', 'user.email=audit@example.invalid', 'commit', '--allow-empty', '-m', 'fixture', '--quiet'],
      { cwd: root },
    );
    const initial = await collect(root);
    assert.deepEqual(
      initial.files.map((file) => file.path),
      ['current.ts', 'empty.txt'],
    );
    await writeFile(join(root, 'current.ts'), 'export const current = 2;');
    const changed = await collect(root);
    assert.throws(() => assertUnchanged(initial, changed), /Source changed/);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('an engine failure preserves the latest successful report and releases scan ownership', async () => {
  const root = await fixture();
  const storage = { runtimeRoot: join(root, '.audit-tools/.runtime'), outputRoot: join(root, '.audit-tools/output') };
  try {
    await mkdir(join(root, 'previous'));
    await writeFile(join(root, 'previous/index.html'), 'previous successful report');
    await publish(storage.outputRoot, 'previous', join(root, 'previous'));
    const pointer = await readFile(join(storage.outputRoot, 'current.json'), 'utf8');
    await execute('git', ['init', '--quiet'], { cwd: root });
    await mkdir(join(root, '.zcode/modules'), { recursive: true });
    await Promise.all([
      writeFile(join(root, '.zcode/module-map.md'), '- [Fixture](modules/fixture.md)：fixture\n'),
      writeFile(join(root, '.zcode/modules/fixture.md'), '# Fixture\n'),
      writeFile(join(root, 'sample.ts'), 'export const sample = 1;'),
      writeFile(join(root, 'Cargo.toml'), '[package\n'),
    ]);
    await execute(
      'git',
      ['-c', 'user.name=Audit Fixture', '-c', 'user.email=audit@example.invalid', 'commit', '--allow-empty', '-m', 'fixture', '--quiet'],
      { cwd: root },
    );
    await assert.rejects(scan(root, {}, storage), /cargo metadata|Cargo.toml/);
    assert.equal(await readFile(join(storage.outputRoot, 'current.json'), 'utf8'), pointer);
    assert.equal(existsSync(join(storage.runtimeRoot, 'active.lock')), false);
    const result = JSON.parse(await readFile(join(storage.runtimeRoot, 'last-run.json'), 'utf8'));
    assert.equal(result.status, 'failed');
    assert.ok(result.error.includes('Cargo.toml'));
  } finally {
    await rm(root, { recursive: true });
  }
});

test('setup commands pin default/optional engines and resolve independently of calling directory', () => {
  const base = setupCommands(false),
    optional = setupCommands(true);
  assert.equal(
    base.some((entry) => entry.name === 'rust-analyzer'),
    true,
  );
  assert.equal(base.find((entry) => entry.name === 'rust-syntax')?.args[0], join(toolRoot, 'src/rust-syntax.mjs'));
  assert.equal(
    base.some((entry) => entry.name === 'venv'),
    false,
  );
  assert.equal(optional.find((entry) => entry.name === 'graphify')?.args.at(-1), join(toolRoot, 'requirements-graphify.lock'));
  assert.equal(base.find((entry) => entry.name === 'npm')?.cwd, projectRoot);
  assert.equal(base.find((entry) => entry.name === 'chromium')?.args[0], join(projectRoot, 'node_modules/playwright/cli.js'));
});

test('maintained tool sources, tests, manifests and documentation use UTF-8 without BOM', async () => {
  const paths = ['README.md', 'package.json', 'requirements-graphify.lock', 'audit.cmd', 'tsconfig.json'];
  for (const directory of ['src', 'test'])
    for (const entry of await readdir(join(toolRoot, directory), { withFileTypes: true }))
      if (entry.isFile()) paths.push(directory + '/' + entry.name);
  for (const path of paths) {
    const bytes = await readFile(join(toolRoot, path));
    assert.notEqual(bytes.subarray(0, 3).toString('hex'), 'efbbbf', path);
    assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes), path);
  }
});

test('workspace shares the main toolchain and inherits strict compiler options for sources and tests', async () => {
  const rootRequire = createRequire(join(projectRoot, 'package.json')),
    toolRequire = createRequire(join(toolRoot, 'package.json'));
  for (const dependency of ['typescript', '@types/node', 'playwright'])
    assert.equal(toolRequire.resolve(dependency + '/package.json'), rootRequire.resolve(dependency + '/package.json'));
  const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  assert.ok(manifest.workspaces.includes('.audit-tools'));
  assert.equal(existsSync(join(toolRoot, 'package-lock.json')), false);
  const host = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (/** @type {ts.Diagnostic} */ diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  };
  const shared = ts.getParsedCommandLineOfConfigFile(join(projectRoot, 'tsconfig.browser-scripts.json'), {}, host);
  const tool = ts.getParsedCommandLineOfConfigFile(join(toolRoot, 'tsconfig.json'), {}, host);
  assert.ok(shared && tool);
  for (const option of Object.keys(shared.options).filter((option) => !['configFilePath', 'types'].includes(option)))
    assert.deepEqual(tool.options[option], shared.options[option], option);
  assert.deepEqual(tool.options.types, ['node', 'emscripten']);
  assert.equal(tool.fileNames.filter((file) => file.replaceAll('\\', '/').includes('/.audit-tools/test/')).length, 9);
});
