import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { summarize } from '../shared/sample-statistics.mjs';
import { sha256 } from './runtime.mjs';

/** @param {import('./session.mjs').Session} session @param {string} directory @param {string} javaHome */
export async function editorQueries(session, directory, javaHome) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'Orbit.java'),
    library = join(directory, 'Library.java');
  const original = '// 星🪐\r\nclass Orbit { Object run(){ return Library.value(1); } }\r';
  await writeFile(file, original);
  await writeFile(
    library,
    'class Library extends Base { static String value(int n){return "x";} static int value(String n){return 1;} } class Base { static int inherited(){return 4;} }',
  );
  const project = 'editor-queries';
  let revision = 1,
    version = 1;
  await session.request('open', { project, sources: [directory], classpath: [], javaHome });
  /** @param {string} purpose @param {number} [offset] @param {string} [path] */
  const inspect = async (purpose, offset = 0, path = file) =>
    (await session.request('inspect', { project, revision, file: path, offset, purpose })).value;
  const samples = [],
    reparsed = [];
  try {
    const document = await inspect('document');
    assert.equal(
      document.diagnostics?.filter(/** @param {{severity:string}} entry */ (entry) => entry.severity === 'error').length ?? 0,
      0,
    );
    assert.deepEqual(
      document.outline.map(/** @param {{name:string}} entry */ (entry) => entry.name),
      ['Orbit', 'run'],
    );
    const projectionBefore = (await session.request('analyze', { project })).value;
    const documentSamples = [];
    for (let index = 0; index < 100; index++) {
      const began = performance.now();
      assert.deepEqual(await inspect('document'), document);
      documentSamples.push(performance.now() - began);
    }
    const projectionAfter = (await session.request('analyze', { project })).value;
    assert.equal(projectionAfter.parseBatches, projectionBefore.parseBatches);
    assert.equal(projectionAfter.referenceIndexBuilds, projectionBefore.referenceIndexBuilds);
    const hover = await inspect('hover', original.indexOf('value'));
    assert.equal(hover.binding.type, 'java.lang.String');
    assert.deepEqual(hover.locations, []);
    const declaration = await inspect('declaration', original.indexOf('value'));
    assert.equal(declaration.locations.length, 1);
    assert.ok(declaration.locations[0].file.endsWith('Library.java'));
    const references = await inspect('references', 43, library);
    assert.equal(references.locations.length, 1);
    assert.equal((await inspect('source')).source, original);
    let text = original;
    for (let round = 0; round < 20; round++) {
      const start = text.indexOf('value(') + 6,
        end = text.indexOf(')', start),
        insert = String(round + 2);
      const next = text.slice(0, start) + insert + text.slice(end);
      const update = await session.request('editorUpdate', {
        project,
        expectedRevision: revision,
        documents: [{ file, version: ++version, source: null, edits: [{ from: start, to: end, text: insert }] }],
      });
      revision = update.value.revision;
      const began = performance.now(),
        incremental = await inspect('document');
      samples.push(performance.now() - began);
      const summary = (await session.request('analyze', { project })).value;
      reparsed.push({ files: summary.files, reparsedFiles: summary.reparsedFiles, fullFallbackReason: summary.fullFallbackReason });
      assert.equal((await inspect('source')).source, next);
      const target = await inspect('hover', next.indexOf('value'));
      await session.request('analyze', { project, forceFull: true });
      assert.deepEqual(await inspect('document'), incremental);
      assert.deepEqual(await inspect('hover', next.indexOf('value')), target);
      text = next;
    }
    const bad = await session.request(
      'editorUpdate',
      {
        project,
        expectedRevision: revision,
        documents: [{ file, version: version + 1, source: null, edits: [{ from: text.length + 1, to: text.length + 1, text: 'x' }] }],
      },
      true,
    );
    assert.equal(bad.value.code, 'engine.invalid_edit');
    assert.equal((await inspect('source')).source, text);
    const stale = await session.request('inspect', { project, revision: 1, file, offset: 0, purpose: 'document' }, true);
    assert.equal(stale.value.code, 'engine.stale_project');
    const before = (await session.request('analyze', { project })).value;
    const repeated = [];
    for (let index = 0; index < 100; index++) {
      const result = await session.request('inspect', { project, revision, file, offset: text.indexOf('value'), purpose: 'hover' });
      repeated.push(result.milliseconds);
    }
    const after = (await session.request('analyze', { project })).value;
    assert.equal(after.parseBatches, before.parseBatches);
    assert.equal(after.referenceIndexBuilds, before.referenceIndexBuilds);
    for (const content of ['class Orbit { int run(){return Library.inherited();} }', 'class Orbit { void run( {', '']) {
      revision = (
        await session.request('editorUpdate', {
          project,
          expectedRevision: revision,
          documents: [{ file, version: ++version, source: content, edits: [] }],
        })
      ).value.revision;
      const projection = await inspect('document');
      if (content.includes('inherited')) assert.equal((await inspect('hover', content.indexOf('inherited'))).binding.type, 'int');
      else if (content)
        assert.ok(projection.diagnostics.some(/** @param {{severity:string}} entry */ (entry) => entry.severity === 'error'));
      else {
        assert.deepEqual(projection.outline, []);
        assert.equal((await inspect('hover')).binding, null);
      }
    }
    assert.equal(await readFile(file, 'utf8'), original);
    return {
      passed: true,
      updates: 20,
      repeatedQueries: 100,
      documents: summarize(documentSamples),
      sourceFingerprint: sha256(original),
      updateFirstQuery: summarize(samples),
      hover: summarize(repeated),
      parseBatchesBefore: before.parseBatches,
      parseBatchesAfter: after.parseBatches,
      rawSamples: { updates: samples, hover: repeated, documents: documentSamples, reparsed },
    };
  } finally {
    await session.request('close', { project });
  }
}
