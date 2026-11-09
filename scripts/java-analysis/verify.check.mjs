import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { TestWorkspace } from '../shared/test-workspace.mjs';

const execute = promisify(execFile);
test('Java verification preserves occupied reports and records preparation failures', async () => {
  const work = await TestWorkspace.create(tmpdir(), 'java-verification');
  try {
    const occupied = work.path('occupied.json');
    await writeFile(occupied, 'owned report\n', 'utf8');
    await assert.rejects(
      execute(process.execPath, ['scripts/java-analysis/verify.mjs', '--game', work.path('game'), '--output', occupied]),
    );
    assert.equal(await readFile(occupied, 'utf8'), 'owned report\n');
    const output = work.path('failed/report.json');
    await assert.rejects(
      execute(process.execPath, ['scripts/java-analysis/verify.mjs', '--game', work.path('game'), '--output', output], {
        env: { ...process.env, AST_JDK: work.path('missing-jdk') },
      }),
    );
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.passed, false);
    assert.equal(report.resourcesReleased, true);
    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0], /ENOENT/);
    assert.match(await readFile(output.replace('.json', '.md'), 'utf8'), /失败/);
  } finally {
    await work.close();
  }
});
