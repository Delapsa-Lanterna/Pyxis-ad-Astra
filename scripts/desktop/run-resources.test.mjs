import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, access, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { TestWorkspace } from '../shared/test-workspace.mjs';
import { desktopConfiguration } from './config.mjs';
import { reserveReport } from './report.mjs';

const execute = promisify(execFile);
const runner = resolve('scripts/desktop/run.mjs');
/** @param {string} path */
async function absent(path) {
  await assert.rejects(access(path), { code: 'ENOENT' });
}

test('native windows retain thread focus on a desktop separate from user input', async () => {
  const work = await TestWorkspace.create(tmpdir(), 'desktop-isolation');
  try {
    const executable = (await execute('pwsh', ['-NoProfile', '-Command', '[Environment]::ProcessPath'])).stdout.trim();
    const output = work.path('probe.json');
    const run = await execute('pwsh', [
      '-NoProfile',
      '-File',
      'scripts/desktop/desktop-host.ps1',
      '-Executable',
      executable,
      '-Log',
      work.path('native.log'),
      '-Arguments:-NoProfile -File "' + resolve('scripts/desktop/desktop-probe.ps1') + '" -Output "' + output + '"',
    ]);
    const probe = JSON.parse(await readFile(output, 'utf8'));
    assert.match(probe.desktop, /^PyxisTesting-/);
    assert.notEqual(probe.desktop, probe.inputDesktop);
    assert.equal(probe.threadFocus, true);
    assert.equal(probe.foregroundAccepted, false);
    const desktop = JSON.parse(run.stdout.slice('DESKTOP_START '.length).trim());
    const released = await execute('pwsh', ['-NoProfile', '-File', 'scripts/desktop/desktop-host.ps1', '-VerifyDesktop', desktop.name]);
    assert.match(released.stdout, /DESKTOP_RELEASED/);
  } finally {
    await work.close();
  }
});

test('desktop dry runs expose the isolated configuration and leave explicit outputs unused', async () => {
  const work = await TestWorkspace.create(tmpdir(), 'desktop-dry');
  try {
    const output = work.path('report.json');
    const result = await execute(process.execPath, [runner, '--dry-run', '--output', output]);
    const config = JSON.parse(result.stdout);
    assert.equal(config.identifier, 'com.delapsa-lanterna.pyxis-ad-astra.desktop-testing');
    assert.equal(config.port, 9233);
    assert.equal(config.isolation, 'win32-desktop');
    assert.ok(config.exe.includes('desktop-testing'));
    await absent(output);
    const build = await execute(process.execPath, ['scripts/desktop/build.mjs', '--dry-run']);
    assert.ok(JSON.parse(build.stdout).args.includes('build'));
  } finally {
    await work.close();
  }
});

test('desktop output conflicts preserve the existing report and its ownership', async () => {
  const work = await TestWorkspace.create(tmpdir(), 'desktop-report');
  try {
    const output = work.path('report.json');
    await writeFile(output, 'owned report', 'utf8');
    await assert.rejects(execute(process.execPath, [runner, '--output', output]), { code: 1 });
    assert.equal(await readFile(output, 'utf8'), 'owned report');
    await absent(work.path('report.md'));
  } finally {
    await work.close();
  }
});

test('desktop preparation failures retain matching JSON and Markdown diagnostics', async () => {
  const work = await TestWorkspace.create(tmpdir(), 'desktop-invalid');
  try {
    const output = work.path('report.json');
    await assert.rejects(execute(process.execPath, [runner, '--suite', 'invalid', '--output', output]), { code: 1 });
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.pass, false);
    assert.equal(report.resourcesReleased, true);
    assert.match(report.errors[0], /Unknown desktop suite/);
    assert.match(await readFile(work.path('report.md'), 'utf8'), /Unknown desktop suite/);
  } finally {
    await work.close();
  }
});

test('desktop startup failure releases its sample and exclusive application directories', async () => {
  const work = await TestWorkspace.create(tmpdir(), 'desktop-startup');
  const { identifier } = await desktopConfiguration();
  try {
    const output = work.path('report.json');
    await assert.rejects(execute(process.execPath, [runner, '--exe', process.execPath, '--output', output]), { code: 1 });
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.pass, false);
    assert.equal(report.resourcesReleased, true);
    assert.ok(report.errors.some((/** @type {string} */ error) => error.includes('exited before the WebView')));
    assert.equal(report.nativeDesktops.length, 1);
    assert.match(report.nativeDesktops[0].name, /^PyxisTesting-/);
    assert.equal(report.nativeDesktops[0].released, true);
    await absent(resolve(process.env.APPDATA ?? '', identifier));
    await absent(resolve(process.env.LOCALAPPDATA ?? '', identifier));
  } finally {
    await work.close();
  }
});

test('desktop occupied ports remain owned by the existing listener', async () => {
  const work = await TestWorkspace.create(tmpdir(), 'desktop-port');
  const config = await desktopConfiguration();
  const server = createServer();
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', () => done(undefined));
    });
    const output = work.path('report.json');
    await assert.rejects(execute(process.execPath, [runner, '--exe', process.execPath, '--output', output]), { code: 1 });
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.ok(report.errors.some((/** @type {string} */ error) => error.includes('EADDRINUSE')));
    assert.equal(server.listening, true);
    assert.equal(report.resourcesReleased, true);
  } finally {
    if (server.listening) await new Promise((done) => server.close(done));
    await work.close();
  }
});

test('desktop reports retain results and failed checks while preserving existing outputs', async () => {
  const work = await TestWorkspace.create(tmpdir(), 'desktop-results');
  try {
    const output = work.path('report.json');
    const report = await reserveReport(output);
    await report.finish({
      suite: 'sources',
      pass: true,
      checks: [{ name: 'Sample', milliseconds: 12.5 }],
      errors: [],
      resourcesReleased: true,
    });
    assert.equal(JSON.parse(await readFile(output, 'utf8')).checks[0].milliseconds, 12.5);
    assert.match(await readFile(work.path('report.md'), 'utf8'), /12\.50/);
    const failed = await reserveReport(work.path('failed.json'));
    await failed.finish({
      suite: 'csv',
      pass: false,
      checks: [{ name: 'Performance budget', milliseconds: 0.5, pass: false }],
      errors: ['CSV budget exceeded'],
      statistics: { fields: { p95: 270 } },
      resourcesReleased: true,
    });
    assert.equal(JSON.parse(await readFile(work.path('failed.json'), 'utf8')).statistics.fields.p95, 270);
    const markdown = await readFile(work.path('failed.md'), 'utf8');
    assert.match(markdown, /Performance budget \| 失败 \| 0\.50/);
    assert.match(markdown, /"p95": 270/);
    const occupied = work.path('occupied.md');
    await writeFile(occupied, 'owned markdown', 'utf8');
    await assert.rejects(reserveReport(work.path('occupied.json')), { code: 'EEXIST' });
    assert.equal(await readFile(occupied, 'utf8'), 'owned markdown');
    await absent(work.path('occupied.json'));
  } finally {
    await work.close();
  }
});
