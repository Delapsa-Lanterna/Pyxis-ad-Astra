import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile, access, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { TestWorkspace } from '../shared/test-workspace.mjs';
import { desktopConfiguration } from './config.mjs';
import { reserveReport } from '../shared/test-output.mjs';
import { startProcessSampler } from './process-sampler.mjs';
import { delay, until } from './runtime.mjs';
import { connectDesktopCdp } from './cdp-client.mjs';
import { createServer as createHttpServer } from 'node:http';

const execute = promisify(execFile);
const runner = resolve('scripts/desktop/run.mjs');

for (const isolatedDesktop of [false, true])
  test(`native windows retain focus and close on the ${isolatedDesktop ? 'isolated' : 'user'} desktop`, async () => {
    const work = await TestWorkspace.create(tmpdir(), 'desktop-close');
    try {
      const executable = (await execute('pwsh', ['-NoProfile', '-Command', '[Environment]::ProcessPath'])).stdout.trim();
      const log = work.path('native.log');
      const child = spawn(
        'pwsh',
        [
          '-NoProfile',
          '-File',
          'scripts/desktop/desktop-host.ps1',
          ...(isolatedDesktop ? ['-IsolatedDesktop'] : []),
          '-Executable',
          executable,
          '-Log',
          log,
          '-Arguments:-NoProfile -File "' +
            resolve('scripts/desktop/desktop-probe.ps1') +
            '" -Output "' +
            work.path('probe.json') +
            '" -WaitForClose',
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let output = '';
      child.stdout.on('data', (part) => {
        output += String(part);
      });
      child.stderr.on('data', (part) => {
        output += String(part);
      });
      const finished = new Promise((done, reject) => {
        child.once('error', reject);
        child.once('close', done);
      });
      try {
        await until(() => {
          if (child.exitCode !== null) throw Error(output);
          return output.includes('DESKTOP_START ');
        }, 'native process ready');
        await until(async () => (await readFile(log, 'utf8')).includes('PROBE_READY'), 'native window ready');
        child.stdin.end('close\n');
        assert.equal(await finished, 0, output);
        const probe = JSON.parse(await readFile(work.path('probe.json'), 'utf8'));
        assert.equal(probe.desktop === probe.inputDesktop, !isolatedDesktop);
        assert.equal(probe.threadFocus, true);
        const desktop = JSON.parse(output.slice('DESKTOP_START '.length).trim());
        if (isolatedDesktop) {
          assert.match(probe.desktop, /^PyxisTesting-/);
          assert.equal(probe.foregroundAccepted, false);
          const released = await execute('pwsh', [
            '-NoProfile',
            '-File',
            'scripts/desktop/desktop-host.ps1',
            '-VerifyDesktop',
            desktop.name,
          ]);
          assert.match(released.stdout, /DESKTOP_RELEASED/);
        } else assert.equal(desktop.name, '');
      } finally {
        if (!child.stdin.writableEnded) child.stdin.end('close\n');
        await finished;
      }
    } finally {
      await work.close();
    }
  });

test('CDP target discovery reports an unavailable WebView and releases its connection', async () => {
  const server = createHttpServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end('[]');
  });
  try {
    await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(connectDesktopCdp('http://127.0.0.1:' + address.port), /Desktop WebView target is unavailable/);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('process sampling records owned CPU and private bytes and closes normally', async () => {
  const sampler = await startProcessSampler(process.pid);
  try {
    await sampler.phase('sample');
    await delay(500);
    const result = sampler.statistics('sample');
    assert.ok(result.samples >= 2);
    assert.ok(result.privateMiB.min !== undefined && result.privateMiB.min > 0);
    assert.ok(result.nativePrivateMiB.min !== undefined && result.nativePrivateMiB.min > 0);
    assert.ok(result.cpuMs >= result.nativeCpuMs);
    assert.ok(sampler.environment.pids.includes(process.pid));
  } finally {
    await sampler.close();
  }
});
/** @param {string} path */
async function absent(path) {
  await assert.rejects(access(path), { code: 'ENOENT' });
}

for (const isolatedDesktop of [false, true])
  test(`desktop dry runs expose the ${isolatedDesktop ? 'isolated' : 'user'} desktop and preserve explicit outputs`, async () => {
    const work = await TestWorkspace.create(tmpdir(), 'desktop-dry');
    try {
      const output = work.path('report.json');
      const result = await execute(process.execPath, [
        runner,
        '--dry-run',
        '--output',
        output,
        ...(isolatedDesktop ? ['--isolated-desktop'] : []),
      ]);
      const config = JSON.parse(result.stdout);
      assert.equal(config.identifier, 'com.delapsa-lanterna.pyxis-ad-astra.desktop-testing');
      assert.equal(config.port, 9233);
      assert.equal(config.isolatedDesktop, isolatedDesktop);
      assert.equal(config.isolation, isolatedDesktop ? 'win32-desktop' : 'user-desktop');
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

for (const isolatedDesktop of [false, true])
  test(`desktop startup failure releases the ${isolatedDesktop ? 'isolated' : 'user'} desktop run and private directories`, async () => {
    const work = await TestWorkspace.create(tmpdir(), 'desktop-startup');
    const { identifier } = await desktopConfiguration();
    try {
      const output = work.path('report.json');
      await assert.rejects(
        execute(process.execPath, [
          runner,
          '--exe',
          process.execPath,
          '--output',
          output,
          ...(isolatedDesktop ? ['--isolated-desktop'] : []),
        ]),
        { code: 1 },
      );
      const report = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(report.pass, false);
      assert.equal(report.resourcesReleased, true);
      assert.ok(report.errors.some((/** @type {string} */ error) => error.includes('exited before the WebView')));
      assert.equal(report.nativeDesktops.length, 1);
      if (isolatedDesktop) assert.match(report.nativeDesktops[0].name, /^PyxisTesting-/);
      else assert.equal(report.nativeDesktops[0].name, '');
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
      kind: 'desktop',
      runs: [],
      suite: 'sources',
      pass: true,
      checks: [{ name: 'Sample', milliseconds: 12.5, pass: true }],
      errors: [],
      resourcesReleased: true,
    });
    assert.equal(JSON.parse(await readFile(output, 'utf8')).checks[0].milliseconds, 12.5);
    assert.match(await readFile(work.path('report.md'), 'utf8'), /12\.50/);
    const failed = await reserveReport(work.path('failed.json'));
    await failed.finish({
      kind: 'desktop',
      runs: [],
      suite: 'csv',
      pass: false,
      checks: [{ name: 'Saved value check', milliseconds: 0.5, pass: false }],
      errors: ['CSV saved value differs'],
      statistics: { fields: { p95: 270 } },
      resourcesReleased: true,
    });
    assert.equal(JSON.parse(await readFile(work.path('failed.json'), 'utf8')).statistics.fields.p95, 270);
    const markdown = await readFile(work.path('failed.md'), 'utf8');
    assert.match(markdown, /Saved value check \| 失败 \| 0\.50/);
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
