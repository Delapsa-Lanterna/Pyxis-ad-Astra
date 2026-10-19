import { readFile } from 'node:fs/promises';
import { collectRepoPaths } from './shared/files.mjs';
import { checkStyles } from './shared/style-source.mjs';

const paths = await collectRepoPaths(process.cwd(), (_, extension) => /\.(?:css|vue|ts|tsx|js|jsx|mjs|html)$/.test(extension));
const files = await Promise.all(paths.map(async (path) => ({ rel: path.rel, text: await readFile(path.path, 'utf8') })));
const failures = checkStyles(files);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('CSS check passed.');
