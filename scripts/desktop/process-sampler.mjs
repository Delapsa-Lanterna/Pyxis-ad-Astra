import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { root } from './config.mjs';
import { until } from './runtime.mjs';
import { summarize } from '../shared/sample-statistics.mjs';

/** @typedef {{kind:'sample',phase:string,ms:number,cpuMs:number,workingBytes:number,privateBytes:number,nativeCpuMs:number,nativePrivateBytes:number}} ProcessSample */
/** @param {number} pid */
export async function startProcessSampler(pid) {
  const child = spawn(
    'pwsh',
    ['-NoProfile', '-File', resolve(root, 'scripts/desktop/process-sampler.ps1'), '-ApplicationPid', String(pid)],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  /** @type {ProcessSample[]} */
  const samples = [];
  /** @type {{pids:number[],logicalProcessors:number}|undefined} */
  let environment;
  let diagnostic = '';
  const finished = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolveExit(code));
  });
  child.stderr.on('data', (part) => {
    diagnostic += String(part);
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const entry = JSON.parse(line);
    if (entry.kind === 'ready') environment = entry;
    else samples.push(entry);
  });
  async function close() {
    child.stdin.end('stop\n');
    const code = await finished;
    if (code !== 0) throw Error('Process sampler exit ' + String(code) + ': ' + diagnostic);
  }
  try {
    await until(() => {
      if (child.exitCode !== null) throw Error('Process sampler startup: ' + diagnostic);
      return environment;
    }, 'process sampler ready');
  } catch (error) {
    await close();
    throw error;
  }
  return {
    samples,
    environment: /** @type {{pids:number[],logicalProcessors:number}} */ (environment),
    close,
    /** @param {string} name */
    async phase(name) {
      child.stdin.write(name + '\n');
      await until(() => samples.at(-1)?.phase === name, 'process phase ' + name);
    },
    /** @param {string} name */
    statistics(name) {
      const rows = samples.filter((row) => row.phase === name);
      const first = /** @type {ProcessSample} */ (rows[0]),
        last = /** @type {ProcessSample} */ (rows.at(-1));
      const milliseconds = last.ms - first.ms;
      return {
        samples: rows.length,
        milliseconds,
        cpuMs: last.cpuMs - first.cpuMs,
        nativeCpuMs: last.nativeCpuMs - first.nativeCpuMs,
        cpuMachinePercent:
          (((last.cpuMs - first.cpuMs) / milliseconds) * 100) / /** @type {{logicalProcessors:number}} */ (environment).logicalProcessors,
        privateMiB: summarize(rows.map((row) => row.privateBytes / 1048576)),
        nativePrivateMiB: summarize(rows.map((row) => row.nativePrivateBytes / 1048576)),
      };
    },
  };
}
