import { readFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename, join } from 'node:path';
import { TestWorkspace, reserveTestOutput } from './test-workspace.mjs';
import { markdown } from './test-report.mjs';

/** @param {string} path */
export async function fileHash(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
/** @param {string[]} directories */
export async function scriptFingerprints(directories) {
  const paths = [];
  for (const directory of directories)
    for (const relative of await readdir(directory, { recursive: true }))
      if (/\.(mjs|ps1)$/.test(relative)) paths.push(directory + '/' + relative.replaceAll('\\', '/'));
  return Object.fromEntries(await Promise.all(paths.sort().map(async (path) => [path, await fileHash(path)])));
}

/** @param {string|undefined} output @param {string} parent */
export async function reserveReport(output, parent = 'node_modules/.cache/testing/reports') {
  const path = output ? resolve(output) : (await TestWorkspace.create(resolve(parent), 'run')).path('report.json');
  const json = await reserveTestOutput(path);
  let readable;
  try {
    readable = await reserveTestOutput(path.replace(/\.json$/, '') + '.md');
  } catch (error) {
    await json.handle.close();
    await unlink(path);
    throw error;
  }
  const artifacts = join(dirname(path), basename(path, '.json') + '-artifacts');
  try {
    await mkdir(artifacts);
  } catch (error) {
    await json.handle.close();
    await readable.handle.close();
    await unlink(path);
    await unlink(readable.path);
    throw error;
  }
  return {
    path,
    artifacts,
    /** @param {import('./test-report.mjs').TestReport} report */
    async finish(report) {
      try {
        await json.handle.writeFile(JSON.stringify(report, null, 2) + '\n', 'utf8');
        await readable.handle.writeFile(markdown(report), 'utf8');
      } finally {
        await json.handle.close();
        await readable.handle.close();
      }
    },
  };
}
