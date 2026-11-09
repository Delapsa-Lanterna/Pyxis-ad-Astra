import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** @param {object} value @returns {object} */
export function semantic(value) {
  return JSON.parse(
    JSON.stringify(value, (key, entry) =>
      [
        'project',
        'analysisMilliseconds',
        'reparsedFiles',
        'invalidatedFiles',
        'incremental',
        'fullFallbackReason',
        'parseBatches',
        'referenceIndexBuilds',
        'heapUsedBytes',
        'heapCommittedBytes',
      ].includes(key)
        ? undefined
        : entry,
    ),
  );
}

/** @param {import('./session.mjs').Session} session @param {string} directory @param {string} javaHome */
export async function incremental(session, directory, javaHome) {
  const first = join(directory, 'src');
  const second = join(directory, 'second');
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });
  /** @type {Map<string,{source:string,version:number}>} */
  const documents = new Map();
  const initial = {
    'mesh/Service.java':
      'package mesh; public class Service { public static final int SCALE=2; public static int compute(){ return 1; } public static Object select(Object value){ return value; } }',
    'mesh/Entry.java':
      'package mesh; class Entry { Object run(){ return Service.compute(); } Object choose(){ return Service.select("x"); } int scale=Service.SCALE; }',
    'mesh/Base.java': 'package mesh; class Base { int inherited(){ return 2; } }',
    'mesh/Other.java': 'package mesh; class Other { int inherited(){ return 3; } }',
    'mesh/Derived.java': 'package mesh; class Derived extends Base { int run(){ return inherited(); } }',
    'mesh/Watcher.java': 'package mesh; class Watcher { Object run(){ return Added.flag(); } }',
    'one/Choice.java': 'package one; public class Choice { public static int value(){return 1;} }',
    'two/Choice.java': 'package two; public class Choice { public static String value(){return "two";} }',
    'mesh/Imported.java': 'package mesh; import one.Choice; class Imported { Object run(){return Choice.value();} }',
    'mesh/Contract.java': 'package mesh; interface Contract { Object contract(); }',
    'mesh/Implementation.java': 'package mesh; class Implementation implements Contract { public Object contract(){return null;} }',
    'quiet/Independent.java': 'package quiet; class Independent { int value(){return 9;} }',
    'alpha/Adapter.java':
      'package alpha; import static beta.Adapter.scale; public class Adapter { @Deprecated public static int value(int n){return scale(n);} }',
    'beta/Adapter.java': 'package beta; public class Adapter { public static int scale(int n){return n+1;} }',
  };
  for (const [relative, source] of Object.entries(initial)) {
    const file = join(first, relative);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, source);
    documents.set(file, { source, version: 1 });
  }
  const project = 'incremental';
  let revision = 1;
  await session.request('open', { project, sources: [first, second], classpath: [], javaHome });
  const before = (await session.request('analyze', { project })).value;
  assert.equal(before.reparsedFiles, documents.size);
  /** @type {{name:string,files:number,reparsedFiles:number,invalidatedFiles:number,incrementalMilliseconds:number,fullMilliseconds:number,fullFallbackReason:string|null,comparedLocations:number}[]} */
  const results = [];
  /** @param {string} relative @param {string} source */
  const replace = (relative, source) => ({
    action: 'replace',
    file: join(first, relative),
    source,
    version: (documents.get(join(first, relative))?.version ?? 0) + 1,
  });
  /** @param {string} name @param {{action:string,file:string,source?:string,target?:string,version:number}[]} changes @param {boolean} [local] */
  const check = async (name, changes, local = false) => {
    await session.request('update', { project, expectedRevision: revision, files: changes });
    revision++;
    for (const change of changes) {
      if (change.action === 'delete' || change.action === 'move') documents.delete(change.file);
      if (change.action !== 'delete') {
        assert.ok(change.source);
        documents.set(change.target ?? change.file, { source: change.source, version: change.version });
      }
    }
    const started = performance.now();
    const increment = (await session.request('analyze', { project })).value;
    const milliseconds = performance.now() - started;
    if (local) assert.equal(increment.reparsedFiles, 1, name);
    /** @type {object[]} */
    const queries = [];
    const selected = [];
    for (const [file, document] of documents) {
      // Compare declarations, call sites, constants, imports and recovered names in every file.
      const tokens = [...document.source.matchAll(/\b[A-Za-z_]\w*\b/gu)].filter(
        (match) =>
          ![
            'package',
            'public',
            'class',
            'static',
            'int',
            'return',
            'void',
            'Object',
            'String',
            'extends',
            'interface',
            'implements',
            'final',
            'null',
          ].includes(match[0]),
      );
      for (const token of tokens) {
        selected.push({ file, offset: token.index });
        queries.push(semantic((await session.request('query', { project, revision, file, offset: token.index })).value));
      }
    }
    const full = await session.request('analyze', { project, forceFull: true });
    assert.deepEqual(semantic(increment), semantic(full.value), name + ': diagnostics and counts');
    for (let index = 0; index < selected.length; index++)
      assert.deepEqual(
        semantic((await session.request('query', { project, revision, ...selected[index] })).value),
        queries[index],
        name + ': semantic query ' + index,
      );
    results.push({
      name,
      files: documents.size,
      reparsedFiles: increment.reparsedFiles,
      invalidatedFiles: increment.invalidatedFiles,
      incrementalMilliseconds: milliseconds,
      fullMilliseconds: full.milliseconds,
      fullFallbackReason: increment.fullFallbackReason,
      comparedLocations: queries.length,
    });
  };
  await check('body', [replace('mesh/Service.java', initial['mesh/Service.java'].replace('return 1;', 'return 4;'))], true);
  await check(
    'annotated-static-import-body',
    [replace('alpha/Adapter.java', initial['alpha/Adapter.java'].replace('{return scale(n);}', '{;return scale(n);}'))],
    true,
  );
  await check('return-type', [replace('mesh/Service.java', initial['mesh/Service.java'].replace('int compute()', 'long compute()'))]);
  await check('parameters', [replace('mesh/Service.java', initial['mesh/Service.java'].replace('compute()', 'compute(int value)'))]);
  await check('overload', [
    replace(
      'mesh/Service.java',
      initial['mesh/Service.java'].replace(
        'public static Object select',
        'public static String select(String value){return value;} public static Object select',
      ),
    ),
  ]);
  await check('constant', [replace('mesh/Service.java', initial['mesh/Service.java'].replace('SCALE=2', 'SCALE=7'))]);
  await check('field-type', [replace('mesh/Entry.java', initial['mesh/Entry.java'].replace('int scale', 'long scale'))]);
  await check('superclass', [replace('mesh/Derived.java', initial['mesh/Derived.java'].replace('extends Base', 'extends Other'))]);
  await check('interface', [replace('mesh/Contract.java', initial['mesh/Contract.java'].replace('Object contract', 'String contract'))]);
  await check('import', [replace('mesh/Imported.java', initial['mesh/Imported.java'].replace('one.Choice', 'two.Choice'))]);
  const added = join(first, 'mesh/Added.java');
  await check('add', [{ action: 'add', file: added, source: 'package mesh; class Added { static int flag(){return 1;} }', version: 1 }]);
  await check('delete', [{ action: 'delete', file: added, version: 2 }]);
  await check('recreate', [
    { action: 'add', file: added, source: 'package mesh; class Added { static String flag(){return "one";} }', version: 1 },
  ]);
  const moved = join(first, 'shift/Added.java');
  await check('package-and-move', [
    {
      action: 'move',
      file: added,
      target: moved,
      source: 'package shift; class Added { static String flag(){return "one";} }',
      version: 2,
    },
  ]);
  await check('cross-root-move', [
    {
      action: 'move',
      file: moved,
      target: join(second, 'shift/Added.java'),
      source: 'package shift; class Added { static String flag(){return "one";} }',
      version: 3,
    },
  ]);
  await check('batch', [
    replace('mesh/Service.java', initial['mesh/Service.java']),
    replace('mesh/Entry.java', initial['mesh/Entry.java']),
  ]);
  for (let index = 0; index < 20; index++)
    await check(
      'continuous-' + index,
      [replace('quiet/Independent.java', initial['quiet/Independent.java'].replace('return 9;', 'return ' + index + ';'))],
      true,
    );
  await session.request('configure', { project, expectedRevision: revision, classpath: [], javaHome, language: '11' });
  revision++;
  const standard = (await session.request('analyze', { project })).value;
  assert.equal(standard.fullFallbackReason, 'language_or_standard_library_changed');
  assert.deepEqual(semantic(standard), semantic((await session.request('analyze', { project, forceFull: true })).value));
  const shadow = join(second, 'one/Choice.java');
  await session.request('update', {
    project,
    expectedRevision: revision,
    files: [
      {
        action: 'add',
        file: shadow,
        source: 'package one; public class Choice { public static String value(){return "shadow";} }',
        version: 1,
      },
    ],
  });
  revision++;
  const originalImport = initial['mesh/Imported.java'];
  const imported = join(first, 'mesh/Imported.java');
  const nextVersion = (documents.get(imported)?.version ?? 1) + 1;
  await session.request('update', {
    project,
    expectedRevision: revision,
    files: [{ action: 'replace', file: imported, source: originalImport, version: nextVersion }],
  });
  revision++;
  await session.request('configure', {
    project,
    expectedRevision: revision,
    sources: [second, first],
    classpath: [],
    javaHome,
    language: '17',
  });
  revision++;
  const selectedFile = join(first, 'mesh/Imported.java');
  const priorityQuery = (await session.request('query', { project, revision, file: selectedFile, offset: originalImport.indexOf('value') }))
    .value;
  assert.equal(priorityQuery.call.binding.type, 'java.lang.String');
  const prioritySummary = (await session.request('analyze', { project })).value;
  assert.deepEqual(semantic(prioritySummary), semantic((await session.request('analyze', { project, forceFull: true })).value));
  await session.request('update', {
    project,
    expectedRevision: revision,
    files: [
      {
        action: 'replace',
        file: join(first, 'one/Choice.java'),
        source: 'package one; public class Choice { public static double value(){return 1;} }',
        version: 2,
      },
    ],
  });
  revision++;
  assert.equal(
    (await session.request('query', { project, revision, file: selectedFile, offset: originalImport.indexOf('value') })).value.call.binding
      .type,
    'java.lang.String',
  );
  await session.request('configure', {
    project,
    expectedRevision: revision,
    sources: [first, second],
    classpath: [],
    javaHome,
    language: '17',
  });
  revision++;
  assert.equal(
    (await session.request('query', { project, revision, file: selectedFile, offset: originalImport.indexOf('value') })).value.call.binding
      .type,
    'double',
  );
  await session.request('close', { project });
  const hello = (await session.request('hello')).value;
  assert.deepEqual(
    (await readdir(hello.workspace)).filter((name) => /^analysis\d+$/u.test(name)),
    [],
  );
  return {
    changes: results,
    fullFallbacks: results.filter((result) => result.fullFallbackReason).length,
    sourceOrderCompared: true,
    standardLibraryFallback: standard.fullFallbackReason,
  };
}
