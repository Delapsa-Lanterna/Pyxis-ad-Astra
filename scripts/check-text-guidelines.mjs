import { readFile } from 'node:fs/promises';
import { collectRepoPaths } from './shared/files.mjs';
import { checkTextGuidelines, isTextGuidelineFile } from './shared/text-guidelines.mjs';

const root = process.cwd();
const paths = await collectRepoPaths(root, (rel, extension) => isTextGuidelineFile(rel, extension));
const files = await Promise.all(paths.map(async (file) => ({ rel: file.rel, text: await readFile(file.path, 'utf8') })));
const failures = checkTextGuidelines(files);
if (failures.length) {
  console.error(failures.join('\n'));
  console.error(`Text guidelines check failed: ${failures.length} violation(s).`);
  process.exitCode = 1;
} else console.log('Text guidelines check passed.');
