import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join, delimiter, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { root, output, reports, resources, executable, readJson, writeJson, files, sha256, run, javaTool } from './runtime.mjs';
import { TestWorkspace } from '../shared/test-workspace.mjs';

const { values } = parseArgs({ options: { game: { type: 'string' }, download: { type: 'boolean' }, 'dry-run': { type: 'boolean' } } });
const game = values.game ?? process.env.AST_GAME;
if (!game) throw new Error('Set AST_GAME or --game to the game directory');
const javaHome = join(game, 'jre');
const java = join(game, 'jre/bin/java.exe');
const counts = ['method', 'constructor', 'enumConstructor', 'methodReference'];

/** @param {string} config @param {string} operation @param {Record<string, unknown>} [extra] */
async function command(config, operation, extra = {}) {
  const path = join(output, operation + '-' + Date.now() + '.json');
  await writeJson(path, { configRoot: config, ...extra });
  const result = await run('host-' + operation, executable, [operation, path]);
  return JSON.parse(result.stdout);
}

class Session {
  /** @param {import('node:child_process').ChildProcessWithoutNullStreams} child */
  constructor(child) {
    this.child = child;
    this.sequence = 0;
    /** @type {Map<number,{done:(value:object)=>void,fail:(error:Error)=>void}>} */
    this.pending = new Map();
    this.errors = '';
    child.stderr.on('data', (data) => {
      this.errors += data;
    });
    this.reader = createInterface({ input: child.stdout });
    this.reader.on('line', (line) => {
      const response = JSON.parse(line);
      const entry = this.pending.get(response.id);
      if (entry) {
        this.pending.delete(response.id);
        entry.done(response);
      }
    });
    this.exit = new Promise((resolve) =>
      child.once('close', (code) => {
        for (const pending of this.pending.values()) pending.fail(new Error(this.errors || 'Host exited'));
        this.pending.clear();
        resolve(code);
      }),
    );
  }
  /** @param {string} config */
  static async start(config) {
    const path = join(output, 'session-' + Date.now() + '.json');
    await writeJson(path, { configRoot: config, java });
    return new Session(spawn(executable, ['run', path], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
  }
  /** @param {string} op @param {Record<string, unknown>} [params] @param {boolean} [error] */
  async request(op, params = {}, error = false) {
    const id = ++this.sequence;
    const started = performance.now();
    /** @type {{error?: object, result?: ReturnType<typeof JSON.parse>}} */
    const result = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Request timed out: ' + op)), 180000);
      this.pending.set(id, {
        done: (value) => {
          clearTimeout(timer);
          done(value);
        },
        fail: (value) => {
          clearTimeout(timer);
          fail(value);
        },
      });
      this.child.stdin.write(JSON.stringify({ id, op, ...params }) + '\n');
    });
    assert.equal(Boolean(result.error), error, JSON.stringify(result));
    return { value: result.result ?? result.error, milliseconds: performance.now() - started };
  }
  async close() {
    this.child.stdin.end();
    assert.equal(await this.exit, 0, this.errors);
    this.reader.close();
  }
}

/** @param {string} source */
async function snapshot(source) {
  const entries = (await files(source)).filter((path) => path.endsWith('.java'));
  const bytes = await Promise.all(entries.map((path) => readFile(path)));
  return {
    entries,
    bytes,
    hash: sha256(
      Buffer.concat(
        bytes.flatMap((data, i) => [Buffer.from(relative(source, entries[i] ?? '').replaceAll('\\', '/') + '\0'), data, Buffer.from([0])]),
      ),
    ),
  };
}

/** @param {Session} session @param {string} directory */
async function workcopies(session, directory) {
  const source = join(directory, 'probe');
  await mkdir(source, { recursive: true });
  const a = 'package probe; public class A { Object run(){ return B.value(); } int scale=B.SCALE; }';
  const b = 'package probe; public class B { public static final int SCALE=6; public static int value(){ return 1; } }';
  const pathA = join(source, 'A.java'),
    pathB = join(source, 'B.java');
  await writeFile(pathA, a);
  await writeFile(pathB, b);
  const before = await snapshot(directory);
  for (const project of ['alpha', 'beta']) await session.request('open', { project, sources: [directory], classpath: [], javaHome });
  /** @param {string} project @param {number} revision */
  const query = async (project, revision) =>
    (await session.request('query', { project, revision, file: pathA, offset: a.indexOf('value') })).value;
  assert.equal((await query('alpha', 1)).call.binding.type, 'int');
  await session.request('update', {
    project: 'alpha',
    files: [
      { file: pathA, source: a, version: 2 },
      { file: pathB, version: 2, source: b.replace('int value()', 'String value()').replace('return 1;', 'return "orbit";') },
    ],
  });
  const changed = await query('alpha', 2);
  assert.equal(changed.call.binding.type, 'java.lang.String');
  assert.ok(changed.declarations.length && changed.references.length);
  assert.equal((await query('beta', 1)).call.binding.type, 'int');
  await session.request('query', { project: 'alpha', revision: 1, file: pathA, offset: 0 }, true);
  await session.request('update', { project: 'alpha', files: [{ file: pathB, source: b, version: 2 }] }, true);
  await session.request('update', { project: 'alpha', files: [{ file: pathB, source: b, version: 3 }] });
  assert.equal((await query('alpha', 3)).call.binding.type, 'int');
  const constant = (await session.request('query', { project: 'alpha', revision: 3, file: pathA, offset: a.indexOf('SCALE') })).value;
  assert.equal(constant.node.binding.constant, 6);
  const first = (await session.request('analyze', { project: 'alpha' })).value;
  const second = (await session.request('analyze', { project: 'alpha' })).value;
  assert.equal(first.parseBatches, second.parseBatches);
  for (const project of ['alpha', 'beta']) await session.request('close', { project });
  assert.equal(before.hash, (await snapshot(directory)).hash);
  return { projects: 2, files: 2, returnTypes: ['int', 'java.lang.String', 'int'], constant: 6, diskUnchanged: true };
}

if (values['dry-run']) console.log(JSON.stringify({ java, output, reports, resources, game, download: values.download }));
else {
  await run('host-build', 'cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '-p', 'pyxis-java-analysis', '--locked']);
  await run('javac-baseline-build', javaTool('javac'), [
    '--release',
    '17',
    '-d',
    output,
    join(root, 'scripts/java-analysis/JavacBaseline.java'),
  ]);
  const work = await TestWorkspace.create(join(output, 'tests'), 'acceptance');
  const config = work.path('configuration 中文 spaces');
  const report = {
    passed: false,
    java,
    package: await readJson(join(resources, 'catalog.json')),
    workcopies: {},
    paths: /** @type {unknown[]} */ ([]),
    mods: /** @type {unknown[]} */ ([]),
  };
  try {
    const initial = await command(config, 'status');
    assert.equal(initial.installed, false);
    await assert.rejects(stat(config));
    await command(config, values.download ? 'install' : 'import', values.download ? {} : { archive: join(output, 'jdt-dependencies.zip') });
    assert.equal((await command(config, 'status')).installed, true);
    const libraries = (await files(join(game, 'starsector-core'))).filter(
      (p) => p.endsWith('.jar') && !relative(join(game, 'starsector-core'), p).includes('\\'),
    );
    for (const directory of [
      'LazyLib/jars',
      'LazyLib/jars/internal',
      'GraphicsLib/jars',
      'MagicLib/jars',
      'LunaLib/jars',
      'LunaLib/jars/libs',
      'BoxUtil/jars',
      'BoxUtil/jars/backends',
      'Console Commands/jars',
      'Nexerelin/jars',
      'UnofficialNewGamePlus/jars',
    ]) {
      try {
        for (const entry of await readdir(join(game, 'mods', directory), { withFileTypes: true }))
          if (entry.isFile() && entry.name.endsWith('.jar')) libraries.push(join(game, 'mods', directory, entry.name));
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
      }
    }
    const session = await Session.start(config);
    try {
      report.workcopies = await workcopies(session, work.path('fixture'));
      for (const newline of ['\n', '\r\n']) {
        const source = '// 🪐' + newline + 'record Orbit(int radius) {}';
        const parsed = (await session.request('parse', { source, version: 1 })).value;
        assert.equal(parsed.errors, 0);
        assert.equal(
          parsed.nodes.find(/** @param {{kind:string}} n */ (n) => n.kind === 'RecordDeclaration').start,
          source.indexOf('record'),
        );
      }
      assert.ok((await session.request('parse', { source: 'class Orbit { void f( {', version: 1 })).value.errors > 0);
      for (const name of ['Polaris_Prime', 'Kratogen_TA', 'Templars']) {
        const source = join(game, 'mods', name, 'src');
        const before = await snapshot(source);
        await session.request('open', { project: name, sources: [source], classpath: libraries, javaHome: join(game, 'jre') });
        const analyzed = await session.request('analyze', { project: name });
        const baseline = JSON.parse(
          (await run('javac-' + name, javaTool('java'), ['-cp', output, 'JavacBaseline', source, libraries.join(delimiter)])).stdout,
        );
        assert.equal(analyzed.value.errors, 0);
        assert.equal(baseline.errors, 0);
        for (const group of counts) {
          assert.equal(analyzed.value[group] ?? 0, baseline[group] ?? 0);
          assert.equal(analyzed.value[group] ?? 0, analyzed.value[group + 'Resolved'] ?? 0);
        }
        for (const bytes of before.bytes)
          assert.equal((await session.request('parse', { source: bytes.toString('utf8'), version: 1 })).value.errors, 0);
        assert.equal(before.hash, (await snapshot(source)).hash);
        await session.request('close', { project: name });
        report.mods.push({
          name,
          files: before.entries.length,
          sha256: before.hash,
          milliseconds: analyzed.milliseconds,
          jdt: analyzed.value,
          javac: baseline,
        });
        console.log(JSON.stringify({ name, files: before.entries.length, errors: 0 }));
      }
    } finally {
      await session.close();
    }
    const paths = (await command(config, 'status')).paths;
    assert.deepEqual(await readdir(paths.workspaces), []);
    assert.ok((await readdir(paths.logs)).length > 0);
    const alias = 'AST' + Date.now().toString(16).slice(-3) + '~1';
    execFileSync('fsutil', ['file', 'setshortname', config, alias], { windowsHide: true });
    const parent = join(config, '..');
    const configs = [join(parent, alias), work.path('long/' + 'a'.repeat(65) + '/' + 'b'.repeat(65) + '/' + 'c'.repeat(65))];
    for (const selected of configs) {
      await command(selected, 'import', { archive: join(output, 'jdt-dependencies.zip') });
      const short = await Session.start(selected);
      try {
        assert.equal((await short.request('parse', { source: 'class Orbit {}', version: 1 })).value.errors, 0);
      } finally {
        await short.close();
      }
      assert.deepEqual(await readdir(join(selected, 'java-analysis/workspaces')), []);
      report.paths.push({ path: selected, characters: selected.length, workspaceReleased: true });
    }
    const offline = await Session.start(config);
    try {
      assert.equal((await offline.request('parse', { source: 'class Orbit {}', version: 1 })).value.errors, 0);
    } finally {
      await offline.close();
    }
    report.passed = true;
  } finally {
    await writeJson(join(reports, 'acceptance.json'), report);
    await work.close();
  }
}
