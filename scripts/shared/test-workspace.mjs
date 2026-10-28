import { mkdir, lstat, readdir, rmdir, unlink, open } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

let sequence = 0;

export class TestWorkspace {
  /** @param {string} root */
  constructor(root) {
    this.root = root;
  }

  /** @param {string} parent @param {string} label */
  static async create(parent, label) {
    await mkdir(parent, { recursive: true });
    for (;;) {
      const root = join(parent, `${label}-${process.pid}-${sequence++}`);
      try {
        await mkdir(root);
        return new TestWorkspace(root);
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
      }
    }
  }

  /** @param {string} relative */
  path(relative) {
    return join(this.root, relative);
  }

  async close() {
    const errors = await removeTestTree(this.root);
    if (errors.length) throw new AggregateError(errors, `Test workspace cleanup failed: ${this.root}`);
  }
}

/** @param {string} path @returns {Promise<Error[]>} */
export async function removeTestTree(path) {
  /** @type {Error[]} */
  const errors = [];
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return errors;
    return [new Error(`Inspect ${path}`, { cause: error })];
  }
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    try {
      for (const entry of await readdir(path)) errors.push(...(await removeTestTree(join(path, entry))));
    } catch (error) {
      errors.push(new Error(`Enumerate ${path}`, { cause: error }));
    }
  }
  try {
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) await rmdir(path);
    else await unlink(path);
  } catch (error) {
    errors.push(new Error(`Remove ${path}`, { cause: error }));
  }
  return errors;
}

/** @param {string} path */
export async function reserveTestOutput(path) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const handle = await open(absolute, 'wx');
  return { path: absolute, handle };
}
