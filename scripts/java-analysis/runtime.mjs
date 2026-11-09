import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const component = join(root, 'src-tauri/java-analysis');
export const output = join(root, 'src-tauri/target/java-analysis');
export const reports = join(output, 'reports');
export const resources = join(component, 'resources');
export const executable = join(root, 'src-tauri/target/debug/java-analysis.exe');

/** @param {string} path */
export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
/** @param {string} path @param {unknown} value */
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
/** @param {string | Buffer} bytes */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
/** @param {string} name @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
export async function run(name, command, args, env = process.env) {
  await mkdir(reports, { recursive: true });
  const started = performance.now();
  const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (data) => {
    stdout += data;
  });
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const exitCode = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('close', done);
  });
  const result = { command, args, exitCode, milliseconds: performance.now() - started, stdout, stderr };
  await writeFile(join(reports, name + '.log'), stdout + stderr, 'utf8');
  await writeJson(join(reports, name + '.json'), result);
  if (exitCode !== 0) throw new Error(`${command} ${args.join(' ')}\nexit=${exitCode}\n${stdout}\n${stderr}`);
  console.log(JSON.stringify({ name, exitCode, milliseconds: result.milliseconds }));
  return result;
}
/** @param {string} directory @returns {Promise<string[]>} */
export async function files(directory) {
  const nested = await Promise.all(
    (await readdir(directory, { withFileTypes: true })).map((entry) =>
      entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
    ),
  );
  return nested.flat().sort();
}
/** @param {string} filename */
export function javaTool(filename) {
  const home = process.env.AST_JDK ?? process.env.JAVA_HOME;
  if (!home) throw new Error('Set AST_JDK or JAVA_HOME to a complete JDK 17');
  return join(home, 'bin', filename + (process.platform === 'win32' ? '.exe' : ''));
}
export function mavenArguments() {
  const executable = execFileSync(
    process.platform === 'win32' ? 'where.exe' : 'which',
    [process.platform === 'win32' ? 'mvn.cmd' : 'mvn'],
    { encoding: 'utf8' },
  )
    .trim()
    .split(/\r?\n/)[0];
  if (!executable) throw new Error('Maven executable was not found');
  const home = process.env.MAVEN_HOME ?? dirname(dirname(executable));
  return [
    '-classpath',
    join(home, 'boot/*'),
    '-Dmaven.home=' + home,
    '-Dclassworlds.conf=' + join(home, 'bin/m2.conf'),
    '-Dmaven.multiModuleProjectDirectory=' + root,
    'org.codehaus.plexus.classworlds.launcher.Launcher',
  ];
}
