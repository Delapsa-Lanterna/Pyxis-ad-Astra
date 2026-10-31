import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, toNamespacedPath } from 'node:path';
import { parseArgs } from 'node:util';
import { TestWorkspace } from './shared/test-workspace.mjs';
import { stripRustCommentsAndStrings } from './shared/rust-source.mjs';

const { values } = parseArgs({
  options: {
    'path-form': { type: 'string', default: 'Ordinary' },
    strict: { type: 'boolean', default: !!process.env.CI },
    'keep-failed': { type: 'boolean', default: false },
    filter: { type: 'string' },
  },
});
const started = performance.now();
const reports = await TestWorkspace.create(resolve('node_modules/.cache/rust-tests'), 'run');
const work = await TestWorkspace.create(tmpdir(), 'pyxis-rust-tests');
/** @type {NodeJS.ProcessEnv & {PYXIS_TEST_ROOT:string, PYXIS_TEST_REPORTS:string}} */
const environment = { ...process.env, PYXIS_TEST_ROOT: work.root, PYXIS_TEST_REPORTS: reports.path('workspaces') };
if (values['keep-failed']) environment.PYXIS_KEEP_FAILED = '1';
/** @type {Array<{command:string, exitCode:number, milliseconds:number}>} */
const commands = [];
/** @type {Array<{test:string, reason:string}>} */
const unavailable = [];
/** @type {Array<{test:string, path:string, retained:boolean, errors:string[]}>} */
const workspaces = [];
let failure;
let testsExitCode = 0;

/** @param {string} command @param {string[]} args @param {boolean} [display] */
async function run(command, args, display = true) {
  const beginning = performance.now();
  const child = spawn(command, args, { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (data) => {
    stdout += data;
    if (display) process.stdout.write(data);
  });
  child.stderr.on('data', (data) => {
    stderr += data;
    if (display) process.stderr.write(data);
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolveExit(code ?? 1));
  });
  commands.push({ command: [command, ...args].join(' '), exitCode, milliseconds: performance.now() - beginning });
  await writeFile(reports.path(`command-${commands.length}.log`), stdout + stderr, 'utf8');
  return { exitCode, stdout, stderr };
}

/** @param {string} form */
async function windowsPath(form) {
  const result = await run(
    'pwsh',
    [
      '-NoProfile',
      '-Command',
      `
Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class TestNames { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern uint GetLongPathName(string p, StringBuilder b, uint n); [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern uint GetShortPathName(string p, StringBuilder b, uint n); }'
$b = [Text.StringBuilder]::new(32768)
$n = [TestNames]::${form === 'Short' ? 'GetShortPathName' : 'GetLongPathName'}($env:PYXIS_TEST_ROOT, $b, 32768)
if ($n -eq 0 -or $n -ge 32768) { throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
[Console]::Write($b.ToString())
`,
    ],
    false,
  );
  if (result.exitCode) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** @param {string} directory @returns {Promise<Array<{file:string, text:string}>>} */
async function rustSources(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await rustSources(file)));
    else if (entry.name.endsWith('.rs')) files.push({ file, text: await readFile(file, 'utf8') });
  }
  return files;
}

/** @param {string[]} names @param {Record<string,string|null>} capabilities */
async function unsupportedTests(names, capabilities) {
  for (const { file, text } of await rustSources('src-tauri/src')) {
    if (file.endsWith('test_support.rs') || file.endsWith('test_support_tests.rs')) continue;
    const code = stripRustCommentsAndStrings(text);
    for (const fn of code.matchAll(/\bfn\s+(\w+)\s*\(/g)) {
      const start = code.indexOf('{', fn.index);
      let end = start + 1,
        depth = 1;
      while (end < code.length && depth) {
        if (code[end] === '{') depth++;
        if (code[end] === '}') depth--;
        end++;
      }
      const body = code.slice(start, end);
      for (const [pattern, ability] of [
        [/TestWorkspace::directory_link\(/, 'directory_link'],
        [/TestWorkspace::file_link\(/, 'file_link'],
        [/TestWorkspace::junction\(/, 'junction'],
        [/\bshort_path\(/, 'short'],
      ]) {
        const reason = capabilities[/** @type {string} */ (ability)];
        if (reason && /** @type {RegExp} */ (pattern).test(body)) {
          for (const name of names.filter((name) => name.endsWith('::' + fn[1])))
            if (!unavailable.some((item) => item.test === name)) unavailable.push({ test: name, reason });
        }
      }
    }
  }
}

try {
  await mkdir(environment.PYXIS_TEST_REPORTS);
  if (process.platform === 'win32') environment.PYXIS_TEST_ROOT = await windowsPath('Long');
  if (values['path-form'] === 'Beyond260') {
    const nested = join(environment.PYXIS_TEST_ROOT, ...Array.from({ length: 12 }, (_, i) => `long-directory-${i}-中文 spaces`));
    await mkdir(nested, { recursive: true });
    if (nested.length <= 260) throw new Error('The requested path does not exceed 260 characters');
    environment.PYXIS_TEST_ROOT = process.platform === 'win32' ? toNamespacedPath(nested) : nested;
  }
  const built = await run('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--no-run', '--message-format', 'json'], false);
  if (built.exitCode) throw new Error(built.stderr);
  const binaries = built.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((item) => item.reason === 'compiler-artifact' && item.profile.test && item.executable)
    .map((item) => item.executable);
  if (!binaries.length) throw new Error('Cargo did not return any test executables');
  const library = binaries.find((binary) => binary.includes('pyxis_ad_astra_lib'));
  const probe = await run(library, ['--exact', 'test_support::tests::workspace_capabilities', '--ignored', '--nocapture'], false);
  if (probe.exitCode) throw new Error(probe.stdout + probe.stderr);
  const result = probe.stdout.split('\n').find((line) => line.startsWith('TEST_CAPABILITIES '));
  if (!result) throw new Error('The filesystem capability probe did not return results');
  const capabilities = JSON.parse(result.slice('TEST_CAPABILITIES '.length));
  if (values['path-form'] === 'Short') {
    if (capabilities.short) {
      unavailable.push({ test: 'path-form:Short', reason: capabilities.short });
    } else environment.PYXIS_TEST_ROOT = await windowsPath('Short');
  }
  for (const binary of binaries) {
    const listed = await run(binary, ['--list'], false);
    if (listed.exitCode) throw new Error(listed.stderr);
    const names = listed.stdout
      .split('\n')
      .filter((line) => line.endsWith(': test'))
      .map((line) => line.slice(0, -6))
      .filter((name) => !values.filter || name.includes(values.filter));
    await unsupportedTests(names, capabilities);
    const args = [
      ...(values.filter ? [values.filter] : []),
      ...unavailable.filter((item) => names.includes(item.test)).flatMap((item) => ['--skip', item.test]),
    ];
    const executed = await run(binary, args);
    testsExitCode ||= executed.exitCode;
  }
  const docs = await run('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--doc', '--quiet']);
  testsExitCode ||= docs.exitCode;
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  testsExitCode = 1;
} finally {
  try {
    for (const name of await readdir(environment.PYXIS_TEST_REPORTS))
      workspaces.push(JSON.parse(await readFile(join(environment.PYXIS_TEST_REPORTS, name), 'utf8')));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
      failure = [failure, String(error)].filter(Boolean).join('\n');
      testsExitCode = 1;
    }
  }
  const retained = workspaces.some((entry) => entry.retained);
  if (!retained) {
    try {
      await work.close();
    } catch (error) {
      failure = [failure, String(error)].filter(Boolean).join('\n');
      testsExitCode = 1;
    }
  }
  if (workspaces.some((entry) => entry.errors.length)) testsExitCode = 1;
  const status = testsExitCode ? 'failed' : unavailable.length ? 'incomplete' : 'passed';
  const exitCode = testsExitCode || (values.strict && unavailable.length ? 1 : 0);
  const report = {
    status,
    exitCode,
    pathForm: values['path-form'],
    testRoot: environment.PYXIS_TEST_ROOT,
    unavailable,
    workspaces,
    commands,
    failure,
    milliseconds: performance.now() - started,
  };
  await writeFile(reports.path('report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ status, exitCode, unavailable, report: reports.path('report.json') }));
  process.exitCode = exitCode;
}
