import { readFile } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { collectRepoPaths } from './shared/files.mjs';

const root = process.cwd();
const textExtensions = new Set(['.bat', '.css', '.fnt', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.rs', '.toml', '.ts', '.vue']);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const failures = [];
for (const file of await collectRepoPaths(root, (_rel, extension) => textExtensions.has(extension))) {
  const bytes = await readFile(file.path);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    failures.push(`${file.rel}: UTF-8 BOM is not allowed`);
    continue;
  }
  try {
    const value = utf8Decoder.decode(bytes);
    if (value.includes('\uFFFD')) failures.push(`${file.rel}: contains a Unicode replacement character`);
  } catch {
    failures.push(`${file.rel}: is not valid UTF-8`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Encoding check passed: UTF-8 without BOM or replacement characters.');
}
