import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { readFile, access } from 'node:fs/promises';
import { TestWorkspace } from '../shared/test-workspace.mjs';

const execute = promisify(execFile);

test('an unmatched performance selection fails with an explicit report', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'pyxis-browser-empty');
  try {
    const output = root.path('empty.json');
    await assert.rejects(
      execute(process.execPath, ['scripts/browser/run.mjs', '--suite', 'lists', '--scene', 'settings', '--output', output]),
      { code: 1 },
    );
    const report = /** @type {{pass:boolean, errors:string[]}} */ (JSON.parse(await readFile(output, 'utf8')));
    assert.equal(report.pass, false);
    assert.ok(report.errors.some((error) => error.includes('没有匹配的性能项目')));
  } finally {
    await root.close();
  }
});

test('browser connection failures retain reports without changing the test workspace', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'pyxis-browser-failure');
  try {
    const output = root.path('failed.json');
    await assert.rejects(
      execute(process.execPath, [
        'scripts/browser/run.mjs',
        '--url',
        'http://127.0.0.1:1',
        '--suite',
        'smoke',
        '--scene',
        'csv',
        '--rounds',
        '1',
        '--output',
        output,
      ]),
      { code: 1 },
    );
    const report = /** @type {{pass:boolean, errors:string[]}} */ (JSON.parse(await readFile(output, 'utf8')));
    assert.equal(report.pass, false);
    assert.ok(report.errors.some((error) => error.includes('ERR_UNSAFE_PORT') || error.includes('ERR_CONNECTION_REFUSED')));
    const before = await readFile(output);
    await assert.rejects(execute(process.execPath, ['scripts/browser/run.mjs', '--url', 'http://127.0.0.1:1', '--output', output]), {
      code: 1,
    });
    assert.deepEqual(await readFile(output), before);
  } finally {
    await root.close();
  }
});

test('parallel browser runs report an unavailable shared service independently', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'pyxis-browser-parallel');
  try {
    const results = await Promise.allSettled(
      [0, 1].map((index) =>
        execute(process.execPath, [
          'scripts/browser/run.mjs',
          '--suite',
          'browser-ui',
          '--url',
          'http://127.0.0.1:1',
          '--output',
          root.path(`run-${index}.json`),
        ]),
      ),
    );
    for (const [index, result] of results.entries()) {
      assert.equal(result.status, 'rejected');
      assert.equal(JSON.parse(await readFile(root.path(`run-${index}.json`), 'utf8')).pass, false);
    }
    for (const index of [0, 1]) assert.ok(JSON.parse(await readFile(root.path(`run-${index}.json`), 'utf8')).errors.length > 0);
    await access(root.path('run-0.md'));
    await access(root.path('run-1.md'));
  } finally {
    await root.close();
  }
});
