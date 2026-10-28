import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { TestWorkspace } from '../shared/test-workspace.mjs';

const execute = promisify(execFile);

test('browser startup and build failures retain reports and release their files', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'circinus-browser-failure');
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
    await assert.rejects(execute(process.execPath, ['scripts/browser/run.mjs', '--output', output]), { code: 1 });
    assert.deepEqual(await readFile(output), before);
    const directory = root.path('not-a-directory');
    await writeFile(directory, 'owned sentinel');
    const buildOutput = root.path('build-failed.json');
    await assert.rejects(execute(process.execPath, ['scripts/browser/run.mjs', '--directory', directory, '--output', buildOutput]), {
      code: 1,
    });
    assert.equal(JSON.parse(await readFile(buildOutput, 'utf8')).pass, false);
    assert.equal(await readFile(directory, 'utf8'), 'owned sentinel');
  } finally {
    await root.close();
  }
});

test('parallel browser runs keep independent builds reports and screenshots', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'circinus-browser-parallel');
  try {
    const results = await Promise.all(
      [0, 1].map((index) =>
        execute(process.execPath, [
          'scripts/browser/run.mjs',
          '--suite',
          'browser-ui',
          '--directory',
          root.path('builds'),
          '--output',
          root.path(`run-${index}.json`),
        ]),
      ),
    );
    for (const [index, result] of results.entries()) {
      assert.ok(result.stdout.includes('"resourcesReleased":true'));
      assert.equal(JSON.parse(await readFile(root.path(`run-${index}.json`), 'utf8')).pass, true);
    }
    assert.deepEqual(await readdir(root.path('builds')), []);
    for (const index of [0, 1]) {
      const pictures = await readdir(root.path(`run-${index}-artifacts/browser-ui`));
      assert.equal(pictures.length, 40);
    }
    await access(root.path('run-0.md'));
    await access(root.path('run-1.md'));
  } finally {
    await root.close();
  }
});
