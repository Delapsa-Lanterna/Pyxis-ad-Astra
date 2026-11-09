import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { run, javaTool, sha256 } from './runtime.mjs';

/** @param {import('./verify.mjs').Session} session @param {string} directory @param {string} javaHome */
export async function lifecycle(session, directory, javaHome) {
  const roots = /** @type {[string, string]} */ ([join(directory, 'sources 中文 spaces'), join(directory, 'second')]);
  await Promise.all(roots.map((root) => mkdir(root, { recursive: true })));
  const pathA = join(roots[0], 'probe/A.java');
  const pathB = join(roots[0], 'probe/B.java');
  await mkdir(join(roots[0], 'probe'));
  const a = 'package probe; public class A { Object run(){ return B.value(); } int scale=B.SCALE; }';
  const b = 'package probe; public class B { public static final int SCALE=6; public static int value(){ return 1; } }';
  await writeFile(pathA, a);
  await writeFile(pathB, b);
  const before = sha256(Buffer.concat([await readFile(pathA), await readFile(pathB)]));
  const open = async (project = 'alpha') => session.request('open', { project, sources: roots, classpath: [], javaHome });
  const summary = async (project = 'alpha') => (await session.request('analyze', { project })).value;
  let revision = 1;
  /** @param {object[]} files @param {boolean} [fails] */
  const update = async (files, fails = false) => {
    const response = await session.request('update', { project: 'alpha', expectedRevision: revision, files }, fails);
    if (!fails) assert.equal(response.value.revision, ++revision);
    return response.value;
  };
  /** @param {string} file @param {string} text @param {string} token @param {string} [project] */
  const query = async (file, text, token, project = 'alpha') =>
    (await session.request('query', { project, revision: project === 'alpha' ? revision : 1, file, offset: text.indexOf(token) })).value;
  await open();
  await open('beta');
  assert.equal((await summary()).errors, 0);
  assert.equal((await query(pathA, a, 'value')).call.binding.type, 'int');
  const stringB = b.replace('int value()', 'String value()').replace('return 1;', 'return "moon";');
  await update([
    { action: 'replace', file: pathA, source: a, version: 2 },
    { action: 'replace', file: pathB, source: stringB, version: 2 },
  ]);
  const changed = await query(pathA, a, 'value');
  assert.equal(changed.call.binding.type, 'java.lang.String');
  assert.equal(changed.project, 'alpha');
  assert.equal(changed.declarations.length, 1);
  assert.equal(changed.references.length, 1);
  assert.equal(changed.declarations[0].version, 2);
  assert.equal((await query(pathA, a, 'value', 'beta')).call.binding.type, 'int');
  const stale = await session.request('query', { project: 'alpha', revision: 1, file: pathA, offset: a.indexOf('value') }, true);
  assert.equal(stale.value.code, 'engine.stale_project');
  assert.equal(stale.value.file, pathA.replaceAll('/', '\\'));
  await update(
    [
      { action: 'replace', file: pathA, source: a.replace('B.value()', 'null'), version: 3 },
      { action: 'replace', file: pathB, source: b, version: 2 },
    ],
    true,
  );
  assert.equal((await query(pathA, a, 'value')).call.binding.type, 'java.lang.String');
  await update([{ action: 'replace', file: pathB, source: b, version: 3 }]);
  assert.equal((await query(pathA, a, 'SCALE')).node.binding.constant, 6);
  const indexBefore = await summary();
  await query(pathA, a, 'value');
  const hotSamples = [];
  for (let index = 0; index < 100; index++) {
    const sample = await session.request('query', { project: 'alpha', revision, file: pathA, offset: a.indexOf('value') });
    assert.equal(sample.value.call.binding.type, 'int');
    hotSamples.push(sample.milliseconds);
  }
  const indexAfter = await summary();
  assert.equal(indexAfter.referenceIndexBuilds, indexBefore.referenceIndexBuilds);
  assert.equal(indexAfter.parseBatches, indexBefore.parseBatches);
  const updates = [];
  for (let index = 1; index <= 20; index++) {
    const current = b.replace('return 1;', 'return ' + index + ';');
    const started = performance.now();
    await update([{ action: 'replace', file: pathB, source: current, version: index + 3 }]);
    assert.equal((await query(pathA, a, 'value')).call.binding.type, 'int');
    updates.push(performance.now() - started);
  }
  const afterUpdates = await summary();
  assert.equal(afterUpdates.parseBatches, indexAfter.parseBatches + 20);
  assert.equal(afterUpdates.referenceIndexBuilds, indexAfter.referenceIndexBuilds + 20);
  const addedPath = join(roots[0], 'probe/C.java');
  const c = 'package probe; class C { int run(){ return B.value(); } }';
  await update([{ action: 'add', file: addedPath, source: c, version: 1 }]);
  assert.equal((await summary()).errors, 0);
  assert.equal((await query(pathA, a, 'value')).references.length, 2);
  const moved = join(roots[0], 'probe/deeper/C.java');
  const movedText = 'package probe.deeper; class C { int run(){ return probe.B.value(); } }';
  await update([{ action: 'move', file: addedPath, target: moved, source: movedText, version: 2 }]);
  assert.equal((await summary()).errors, 0);
  assert.equal(
    (await query(pathA, a, 'value')).references.some(
      /** @param {{file:string}} entry */ (entry) => entry.file === moved.replaceAll('/', '\\'),
    ),
    true,
  );
  const crossRoot = join(roots[1], 'probe/deeper/C.java');
  await update([{ action: 'move', file: moved, target: crossRoot, source: movedText, version: 3 }]);
  assert.equal((await summary()).errors, 0);
  assert.equal((await query(crossRoot, movedText, 'value')).call.binding.type, 'int');
  await update([{ action: 'delete', file: pathB, version: 24 }]);
  assert.ok((await summary()).errors > 0);
  assert.ok(!(await query(pathA, a, 'value')).call.binding || (await query(pathA, a, 'value')).call.binding.recovered);
  await update([{ action: 'add', file: pathB, source: b, version: 1 }]);
  assert.equal((await summary()).errors, 0);
  assert.equal((await query(pathA, a, 'value')).call.binding.recovered, false);
  await update([{ action: 'delete', file: crossRoot, version: 4 }]);
  assert.equal((await query(pathA, a, 'value')).references.length, 1);
  for (const batch of [
    [{ action: 'add', file: pathA, source: a, version: 1 }],
    [{ action: 'move', file: pathA, target: pathB, source: a, version: 3 }],
    [{ action: 'add', file: join(directory, 'Outside.java'), source: 'class Outside {}', version: 1 }],
    [
      { action: 'replace', file: pathA, source: a, version: 3 },
      { action: 'delete', file: pathA, version: 3 },
    ],
  ])
    await update(batch, true);
  assert.equal((await summary()).errors, 0);
  assert.equal(sha256(Buffer.concat([await readFile(pathA), await readFile(pathB)])), before);
  assert.deepEqual(await readdir(roots[1]), []);
  for (const project of ['alpha', 'beta']) await session.request('close', { project });
  const cycles = [];
  const hello = (await session.request('hello')).value;
  for (let index = 0; index < 10; index++) {
    const project = 'release-' + index;
    await open(project);
    await session.request('update', { project, expectedRevision: 1, files: [{ action: 'replace', file: pathB, source: b, version: 2 }] });
    assert.equal((await summary(project)).errors, 0);
    await session.request('close', { project });
    const privateProjects = (await readdir(hello.workspace)).filter((entry) => /^analysis\d+$/.test(entry));
    assert.deepEqual(privateProjects, []);
    cycles.push({ project, projectsRemaining: privateProjects.length });
  }
  return {
    projects: 2,
    sourceFiles: 2,
    returnTypes: ['int', 'java.lang.String', 'int'],
    constant: 6,
    repeatedQueries: 100,
    queryMilliseconds: timing(hotSamples),
    twentyUpdateAndFirstQueryMilliseconds: timing(updates),
    invalidBatchPreserved: true,
    crossRootMove: true,
    deletedTypeHidden: true,
    sourceSha256: before,
    diskUnchanged: true,
    releaseCycles: cycles,
  };
}

/** @param {number[]} values */
export function timing(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return { samples: values, median: sorted[Math.ceil(sorted.length * 0.5) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

/** @param {import('./verify.mjs').Session} session @param {string} directory @param {string} javaHome */
export async function dependencies(session, directory, javaHome) {
  const sourceRoot = join(directory, 'src');
  await mkdir(sourceRoot, { recursive: true });
  const client = join(sourceRoot, 'Consumer.java');
  const source = 'class Consumer { Object run(){ return sample.Library.value("x"); } }';
  await writeFile(client, source);
  /** @param {string} name @param {string} type */
  const build = async (name, type) => {
    const folder = join(directory, name);
    const source = join(folder, 'Library.java');
    await mkdir(folder);
    await writeFile(
      source,
      'package sample; public class Library { public static ' +
        type +
        ' value(String s){ return ' +
        (type === 'String' ? 's' : '1') +
        '; } public static Object value(Object s){ return s; } }',
    );
    await run('fixture-javac-' + name, javaTool('javac'), ['--release', '17', '-d', folder, source]);
    const jar = join(directory, name + '.jar');
    await run('fixture-jar-' + name, javaTool('jar'), ['--create', '--file', jar, '-C', folder, 'sample']);
    return jar;
  };
  const integer = await build('integer', 'int');
  const string = await build('string', 'String');
  const fixed = join(directory, 'fixed.jar');
  await copyFile(integer, fixed);
  await session.request('open', { project: 'dependencies', sources: [sourceRoot], classpath: [integer], javaHome });
  let revision = 1;
  const query = async () =>
    (await session.request('query', { project: 'dependencies', revision, file: client, offset: source.indexOf('value') })).value;
  const initial = await query();
  assert.equal(initial.call.binding.type, 'int');
  assert.deepEqual(initial.call.binding.parameters, ['java.lang.String']);
  /** @param {string[]} classpath */
  const configure = async (classpath) => {
    await session.request('configure', { project: 'dependencies', expectedRevision: revision, classpath, javaHome, language: '17' });
    revision++;
  };
  await configure([string]);
  assert.equal((await query()).call.binding.type, 'java.lang.String');
  await configure([fixed]);
  assert.equal((await query()).call.binding.type, 'int');
  const old = await stat(fixed);
  const oldHash = sha256(await readFile(fixed));
  await copyFile(string, fixed);
  const currentHash = sha256(await readFile(fixed));
  await configure([fixed]);
  const replacement = await query();
  assert.equal(replacement.call.binding.type, 'java.lang.String');
  assert.equal(replacement.version, 1);
  await configure([]);
  assert.ok((await session.request('analyze', { project: 'dependencies' })).value.errors > 0);
  await configure([string]);
  assert.equal((await session.request('analyze', { project: 'dependencies' })).value.errors, 0);
  assert.equal(await readFile(client, 'utf8'), source);
  await session.request('close', { project: 'dependencies' });
  return {
    configurations: revision - 1,
    returnTypes: ['int', 'java.lang.String', 'int', 'java.lang.String'],
    overloadParameters: initial.call.binding.parameters,
    samePathJar: { beforeBytes: old.size, beforeSha256: oldHash, afterSha256: currentHash },
    documentVersion: replacement.version,
    removedDependencyDiagnosed: true,
    restoredDependencyResolved: true,
  };
}
