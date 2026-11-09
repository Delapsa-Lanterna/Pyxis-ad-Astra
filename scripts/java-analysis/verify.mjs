import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, readdir } from 'node:fs/promises';
import { join, delimiter, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Session, command } from './session.mjs';
import { root, output, reports, resources, readJson, files, sha256, run, javaTool, versions, setReportDirectory } from './runtime.mjs';
import { TestWorkspace, reserveTestOutput } from '../shared/test-workspace.mjs';
import { lifecycle, dependencies } from './lifecycle.mjs';
import { performanceComparison } from './performance.mjs';
import { incremental } from './incremental.mjs';

const { values } = parseArgs({
  options: {
    game: { type: 'string' },
    download: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    output: { type: 'string' },
    warmup: { type: 'string', default: '2' },
    rounds: { type: 'string', default: '30' },
  },
});
const game = values.game ?? process.env.AST_GAME;
if (!game) throw new Error('Set AST_GAME or --game to the game directory');
const javaHome = join(game, 'jre');
const java = join(game, 'jre/bin/java.exe');
const counts = ['method', 'constructor', 'enumConstructor', 'methodReference'];

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

if (values['dry-run']) console.log(JSON.stringify({ java, output, reports, resources, game, download: values.download }));
else {
  const directory = values.output ? resolve(join(values.output, '..')) : (await TestWorkspace.create(join(output, 'reports'), 'run')).root;
  const reportOutput = await reserveTestOutput(values.output ?? join(directory, 'acceptance.json'));
  const markdownOutput = await reserveTestOutput(reportOutput.path.replace(/\.json$/, '') + '.md');
  setReportDirectory(join(directory, 'commands'));
  /** @type {TestWorkspace | undefined} */
  let work;
  const report = {
    passed: false,
    errors: /** @type {string[]} */ ([]),
    java,
    package: await readJson(join(resources, 'catalog.json')),
    workcopies: {},
    dependencies: {},
    incremental: {},
    performance: /** @type {unknown[]} */ ([]),
    libraryInventory: /** @type {{path:string,sha256:string}[]} */ ([]),
    paths: /** @type {unknown[]} */ ([]),
    mods: /** @type {unknown[]} */ ([]),
  };
  try {
    await run('host-build', 'cargo', [
      'build',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '-p',
      'pyxis-java-analysis',
      '--example',
      'java-analysis',
      '--locked',
    ]);
    await run('javac-baseline-build', javaTool('javac'), [
      '--release',
      String(versions.java),
      '-d',
      output,
      join(root, 'scripts/java-analysis/JavacBaseline.java'),
    ]);
    work = await TestWorkspace.create(join(output, 'tests'), 'acceptance');
    const config = work.path('configuration 中文 spaces');
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
    const libraryInventory = await Promise.all(libraries.map(async (path) => ({ path, sha256: sha256(await readFile(path)) })));
    const session = await Session.start(config, java);
    const corpora = [];
    try {
      report.workcopies = await lifecycle(session, work.path('fixture'), javaHome);
      report.dependencies = await dependencies(session, work.path('dependency-fixture'), javaHome);
      report.incremental = await incremental(session, work.path('incremental'), javaHome);
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
          (
            await run('javac-' + name, javaTool('java'), [
              '-cp',
              output,
              'JavacBaseline',
              source,
              libraries.join(delimiter),
              versions.language,
            ])
          ).stdout,
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
          memory: { heapUsedBytes: analyzed.value.heapUsedBytes, heapCommittedBytes: analyzed.value.heapCommittedBytes },
          javac: baseline,
        });
        corpora.push({ name, root: source, files: before.entries, hash: before.hash });
        console.log(JSON.stringify({ name, files: before.entries.length, errors: 0 }));
      }
    } finally {
      await session.close();
    }
    const paths = (await command(config, 'status')).paths;
    report.performance = await performanceComparison(config, java, corpora, libraries, {
      warmup: Number(values.warmup),
      rounds: Number(values.rounds),
    });
    for (const corpus of corpora) assert.equal((await snapshot(corpus.root)).hash, corpus.hash);
    for (const entry of libraryInventory) assert.equal(sha256(await readFile(entry.path)), entry.sha256);
    report.libraryInventory = libraryInventory;
    assert.deepEqual(await readdir(paths.workspaces), []);
    assert.ok((await readdir(paths.logs)).length > 0);
    const alias = 'AST' + Date.now().toString(16).slice(-3) + '~1';
    execFileSync('fsutil', ['file', 'setshortname', config, alias], { windowsHide: true });
    const parent = join(config, '..');
    const configs = [join(parent, alias), work.path('long/' + 'a'.repeat(65) + '/' + 'b'.repeat(65) + '/' + 'c'.repeat(65))];
    for (const selected of configs) {
      await command(selected, 'import', { archive: join(output, 'jdt-dependencies.zip') });
      const short = await Session.start(selected, java);
      try {
        assert.equal((await short.request('parse', { source: 'class Orbit {}', version: 1 })).value.errors, 0);
        const source = join(selected, 'source 中文 spaces');
        const probe = join(source, 'probe/Orbit.java');
        await mkdir(join(source, 'probe'), { recursive: true });
        await short.request('open', { project: 'path', sources: [source], classpath: [], javaHome });
        const text = '// 🪐\r\npackage probe; class Orbit { int run(){ return value(); } int value(){ return 4; } }';
        await short.request('update', {
          project: 'path',
          expectedRevision: 1,
          files: [{ action: 'add', file: probe, source: text, version: 1 }],
        });
        const query = (await short.request('query', { project: 'path', revision: 2, file: probe, offset: text.indexOf('value') })).value;
        assert.equal(query.call.binding.type, 'int');
        assert.equal(query.call.start, text.indexOf('value'));
        assert.equal(query.declarations[0].version, 1);
        await short.request('close', { project: 'path' });
        await assert.rejects(stat(probe));
      } finally {
        await short.close();
      }
      assert.deepEqual(await readdir(join(selected, 'java-analysis/workspaces')), []);
      report.paths.push({
        path: selected,
        characters: selected.length,
        sourceCharacters: join(selected, 'source 中文 spaces/probe/Orbit.java').length,
        unsavedQuery: true,
        workspaceReleased: true,
      });
    }
    const offline = await Session.start(config, java);
    try {
      assert.equal((await offline.request('parse', { source: 'class Orbit {}', version: 1 })).value.errors, 0);
    } finally {
      await offline.close();
    }
    report.passed = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  } finally {
    let resourcesReleased = true;
    try {
      await work?.close();
    } catch (error) {
      resourcesReleased = false;
      report.errors.push(String(error));
      report.passed = false;
      process.exitCode = 1;
    }
    const environment = {
      node: process.version,
      java,
      engineSha256: sha256(await readFile(join(resources, 'engine.jar'))),
      launcherSha256: sha256(await readFile(join(resources, 'launcher.jar'))),
      scriptSha256: sha256(await readFile(new URL('./verify.mjs', import.meta.url))),
    };
    try {
      await reportOutput.handle.writeFile(JSON.stringify({ ...report, environment, resourcesReleased }, null, 2) + '\n', 'utf8');
      await markdownOutput.handle.writeFile(
        '# Java 分析验收\n\n判定：' +
          (report.passed ? '通过' : '失败') +
          '\n\n```json\n' +
          JSON.stringify({ environment, mods: report.mods, performance: report.performance }, null, 2) +
          '\n```\n',
        'utf8',
      );
    } finally {
      await reportOutput.handle.close();
      await markdownOutput.handle.close();
    }
    console.log(JSON.stringify({ output: reportOutput.path, pass: report.passed, resourcesReleased }));
  }
}
