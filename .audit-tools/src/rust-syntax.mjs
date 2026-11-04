import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash, runtimeRoot } from './runtime.mjs';

export const syntaxVersion = '0.24.2';
const syntaxHash = '24c89bd9252255e4aebbcbd7d2d308bd92c86dd95a130fdc80efa49577b8d738';
export const syntaxPath = join(runtimeRoot, 'tools/tree-sitter-rust/tree-sitter-rust.wasm');

/** Installs the pinned upstream grammar for source structure and syntax roles. */
export async function installSyntax() {
  const response = await fetch(
    'https://github.com/tree-sitter/tree-sitter-rust/releases/download/v' + syntaxVersion + '/tree-sitter-rust.wasm',
  );
  if (!response.ok) throw new Error('Rust syntax download: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== syntaxHash) throw new Error('Rust syntax SHA-256 differs from the pinned release');
  await mkdir(join(runtimeRoot, 'tools/tree-sitter-rust'), { recursive: true });
  await writeFile(syntaxPath, bytes);
}

/** Records the actual syntax engine identity used by the scan. */
export async function syntaxIdentity() {
  return { version: syntaxVersion, sha256: hash(await readFile(syntaxPath)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  installSyntax().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
