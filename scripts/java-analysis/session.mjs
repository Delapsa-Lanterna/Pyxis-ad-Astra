import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { join, dirname, basename } from 'node:path';
import { root, executable, writeJson, run } from './runtime.mjs';

/** @param {string} config @param {string} operation @param {Record<string, unknown>} [extra] */
export async function command(config, operation, extra = {}) {
  const path = join(dirname(config), 'requests/' + operation + '-' + randomUUID() + '.json');
  await writeJson(path, { configRoot: config, ...extra });
  const result = await run('host-' + basename(path, '.json'), executable, [operation, path]);
  return JSON.parse(result.stdout);
}

export class Session {
  /** @param {import('node:child_process').ChildProcessWithoutNullStreams} child */
  constructor(child) {
    this.child = child;
    this.sequence = 0;
    /** @type {Map<number,{done:(value:object)=>void,fail:(error:Error)=>void}>} */
    this.pending = new Map();
    this.errors = '';
    this.exited = false;
    child.stderr.on('data', (data) => {
      this.errors += data;
    });
    this.reader = createInterface({ input: child.stdout });
    this.reader.on('line', (line) => {
      const response = JSON.parse(line);
      const entry = this.pending.get(response.id);
      if (entry) {
        this.pending.delete(response.id);
        entry.done(response);
      }
    });
    this.exit = new Promise((resolve) =>
      child.once('close', (code) => {
        this.exited = true;
        for (const pending of this.pending.values()) pending.fail(new Error(this.errors || 'Host exited'));
        this.pending.clear();
        resolve(code);
      }),
    );
  }
  /** @param {string} config @param {string} java */
  static async start(config, java) {
    const path = join(dirname(config), 'requests/session-' + randomUUID() + '.json');
    await writeJson(path, { configRoot: config, java });
    return new Session(spawn(executable, ['run', path], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
  }
  async hello() {
    const sample = await this.request('hello');
    this.pid = sample.value.pid;
    return sample;
  }
  /** @param {string} op @param {Record<string, unknown>} [params] @param {boolean} [error] */
  async request(op, params = {}, error = false) {
    assert.equal(this.exited, false, 'Analysis process exited: ' + this.errors);
    const id = ++this.sequence;
    const started = performance.now();
    /** @type {{error?: object, result?: ReturnType<typeof JSON.parse>}} */
    const result = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Request timed out: ' + op)), 180000);
      this.pending.set(id, {
        done: (value) => {
          clearTimeout(timer);
          done(value);
        },
        fail: (value) => {
          clearTimeout(timer);
          fail(value);
        },
      });
      this.child.stdin.write(JSON.stringify({ id, op, ...params }) + '\n');
    });
    assert.equal(Boolean(result.error), error, JSON.stringify(result) + '\n' + this.errors);
    return { value: result.result ?? result.error, milliseconds: performance.now() - started };
  }
  async close() {
    if (this.exited) {
      this.reader.close();
      return;
    }
    if (!this.pid) await this.hello();
    await this.request('shutdown');
    this.child.stdin.end();
    assert.equal(await this.exit, 0, this.errors);
    this.reader.close();
    assert.throws(() => process.kill(this.pid, 0));
  }
}
