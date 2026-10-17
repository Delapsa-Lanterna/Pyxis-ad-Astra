import { readFile } from 'node:fs/promises';
import { collectArchitectureFiles, collectRepoPaths } from './shared/files.mjs';
import { rules } from './architecture/rules/index.mjs';
import { checkCssScope, checkStyleEntry } from './architecture/rules/css-token-boundary.mjs';

const files = await collectArchitectureFiles(process.cwd());
const failures = files.flatMap((file) => file.dependencyFailures);
for (const file of await collectRepoPaths(process.cwd(), (_, extension) => /\.(?:vue|css|ts|tsx|js|jsx|mjs|html)$/.test(extension))) {
  const source = { rel: file.rel, text: await readFile(file.path, 'utf8') };
  failures.push(...checkStyleEntry(source));
  if (file.rel.endsWith('.css')) failures.push(...checkCssScope(source));
}

for (const rule of rules) {
  failures.push(...rule.check(files));
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}

if (failures.length === 0) console.log('Architecture check passed.');
