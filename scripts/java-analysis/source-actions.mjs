import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { summarize } from '../shared/sample-statistics.mjs';

/** @param {import('./session.mjs').Session} session @param {string} directory @param {string} javaHome */
export async function sourceActions(session, directory, javaHome) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'Entry.java'),
    base = join(directory, 'Base.java');
  const original =
    '// 星🪐\r\nclass Entry extends Base { int count=2; int run(int size){return count+size;} String invoke(){return value(1);} }\r\n';
  await writeFile(file, original);
  await writeFile(base, 'class Base { String value(int n){return "a";} String value(String n){return n;} }');
  const project = 'source-actions';
  let revision = 1,
    version = 1;
  await session.request('open', { project, sources: [directory], classpath: [], javaHome });
  /** @param {string} purpose @param {number} [offset] @param {Record<string,unknown>} [extra] */
  const assist = async (purpose, offset = 0, extra = {}) =>
    (await session.request('assist', { project, revision, file, offset, purpose, ...extra })).value;
  try {
    /** @param {string} purpose @param {number} offset @param {Record<string,unknown>} [extra] */
    const measure = async (purpose, offset, extra = {}) => {
      const raw = [];
      let bytes = 0;
      for (let round = 0; round < 32; round++) {
        const began = performance.now();
        const result = await assist(purpose, offset, extra);
        raw.push(performance.now() - began);
        bytes = Buffer.byteLength(JSON.stringify(result));
      }
      return { raw, bytes, statistics: summarize(raw.slice(2)) };
    };
    const rename = await assist('rename', original.indexOf('count'), { name: 'size' });
    const renamePerformance = await measure('rename', original.indexOf('count'), { name: 'size' });
    assert.equal(rename.files.length, 1);
    assert.ok(rename.files[0].edits.some(/** @param {{text:string}} edit */ (edit) => edit.text === 'this.size'));
    await assist('validate', 0);
    const patch = /** @param {string} text @param {{from:number,to:number,text:string}[]} edits */ (text, edits) => {
      for (const edit of [...edits].reverse()) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
      return text;
    };
    const updated = patch(original, rename.files[0].edits);
    revision = (
      await session.request('editorUpdate', {
        project,
        expectedRevision: revision,
        documents: [{ file, version: ++version, source: updated, edits: [] }],
      })
    ).value.revision;
    assert.equal((await session.request('analyze', { project })).value.errors, 0);
    const stale = await session.request('assist', { project, revision: 1, file, offset: 0, purpose: 'validate' }, true);
    assert.equal(stale.value.code, 'engine.stale_project');
    const completionSource = 'class Entry extends Base {String run(){return val;}}';
    revision = (
      await session.request('editorUpdate', {
        project,
        expectedRevision: revision,
        documents: [{ file, version: ++version, source: completionSource, edits: [] }],
      })
    ).value.revision;
    const candidates = await assist('complete', completionSource.indexOf('val;') + 3);
    const completionPerformance = await measure('complete', completionSource.indexOf('val;') + 3);
    assert.equal(candidates.candidates.filter(/** @param {{label:string}} item */ (item) => item.label === 'value').length, 2);
    const signatureSource = 'class Entry extends Base {String run(){return value();}}';
    revision = (
      await session.request('editorUpdate', {
        project,
        expectedRevision: revision,
        documents: [{ file, version: ++version, source: signatureSource, edits: [] }],
      })
    ).value.revision;
    const signatures = await assist('signature', signatureSource.indexOf('value(') + 6);
    const signaturePerformance = await measure('signature', signatureSource.indexOf('value(') + 6);
    assert.equal(signatures.candidates.length, 2);
    const imported = 'import java.util.Set;\r\nclass Entry {List<String> values;}\r\n';
    revision = (
      await session.request('editorUpdate', {
        project,
        expectedRevision: revision,
        documents: [{ file, version: ++version, source: imported, edits: [] }],
      })
    ).value.revision;
    const choices = await assist('imports');
    assert.ok(choices.choices[0].candidates.includes('java.util.List'));
    assert.equal(choices.files.length, 0);
    const organized = await assist('imports', 0, { choices: { List: 'java.util.List' } });
    const text = patch(imported, organized.files[0].edits);
    assert.ok(text.includes('import java.util.List;\r\n'));
    assert.ok(!text.includes('import java.util.Set;'));
    const times = [];
    for (let round = 0; round < 32; round++) {
      const before = performance.now();
      await assist('imports', 0, { choices: { List: 'java.util.List' } });
      times.push(performance.now() - before);
    }
    assert.equal(await readFile(file, 'utf8'), original);
    const child = 'class Entry extends Base {String value(int n){return "child";}}';
    revision = (
      await session.request('update', {
        project,
        expectedRevision: revision,
        files: [
          { action: 'replace', file, version: ++version, source: child },
          { action: 'replace', file: base, version: 2, source: 'class Base {String value(int n){return "base";}}' },
          {
            action: 'add',
            file: join(directory, 'Sibling.java'),
            version: 1,
            source: 'class Sibling extends Base {String value(int n){return "sibling";}}',
          },
        ],
      })
    ).value.revision;
    const hierarchy = await assist('rename', child.indexOf('value'), { name: 'measure' });
    assert.equal(hierarchy.files.length, 3);
    const external = 'class Base implements Runnable {public void run(){}}';
    revision = (
      await session.request('update', {
        project,
        expectedRevision: revision,
        files: [{ action: 'replace', file: base, version: 3, source: external }],
      })
    ).value.revision;
    const contract = await assist('rename', external.indexOf('run()'), { file: base, name: 'go' });
    assert.ok(contract.conflicts.includes('binary_override_contract'));
    assert.equal(contract.files.length, 0);
    const constructor = 'class Entry {Entry(){}}';
    revision = (
      await session.request('update', {
        project,
        expectedRevision: revision,
        files: [{ action: 'replace', file, version: ++version, source: constructor }],
      })
    ).value.revision;
    const constructorPlan = await assist('rename', constructor.lastIndexOf('Entry('), { name: 'Beacon' });
    assert.equal(constructorPlan.files[0].edits.length, 2);
    assert.ok(constructorPlan.files[0].target.endsWith('Beacon.java'));
    const generic = 'class Entry<T> {Entry(int n){} Entry(String n){} void run(){new Entry<String>();}}';
    revision = (
      await session.request('update', {
        project,
        expectedRevision: revision,
        files: [{ action: 'replace', file, version: ++version, source: generic }],
      })
    ).value.revision;
    const constructorSignatures = await assist('signature', generic.indexOf('Entry<String>(') + 'Entry<String>('.length);
    assert.equal(constructorSignatures.candidates.length, 2);
    return {
      passed: true,
      protocol: 4,
      overloads: 2,
      sourceVersions: version,
      importChoices: choices.choices,
      renameEdits: rename.files[0].edits,
      imports: { raw: times, statistics: summarize(times.slice(2)) },
      performance: { rename: renamePerformance, completion: completionPerformance, signature: signaturePerformance },
      hierarchyFiles: hierarchy.files.length,
      binaryContractRejected: true,
    };
  } finally {
    await session.request('close', { project });
  }
}
