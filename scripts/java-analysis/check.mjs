import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { root, component, output, resources, files, sha256, run, javaTool } from './runtime.mjs';

const { values } = parseArgs({ options: { format: { type: 'boolean' }, 'dry-run': { type: 'boolean' } } });
const FORMATTER = {
  version: '1.24.0',
  sha256: '812f805f58112460edf01bf202a8e61d0fd1f35c0d4fabd54220640776ec57a1',
};
const formatter = join(output, 'cache/google-java-format-' + FORMATTER.version + '.jar');
if (values['dry-run']) console.log(JSON.stringify({ component, output, formatter, format: values.format }));
else {
  let jar;
  try {
    jar = await readFile(formatter);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    const response = await fetch(
      `https://repo.maven.apache.org/maven2/com/google/googlejavaformat/google-java-format/${FORMATTER.version}/google-java-format-${FORMATTER.version}-all-deps.jar`,
    );
    if (!response.ok) throw new Error('Formatter download failed: ' + response.status, { cause: error });
    jar = Buffer.from(await response.arrayBuffer());
    if (sha256(jar) !== FORMATTER.sha256) throw new Error('Formatter checksum mismatch', { cause: error });
    await mkdir(join(output, 'cache'), { recursive: true });
    await writeFile(formatter, jar);
  }
  if (sha256(jar) !== FORMATTER.sha256) throw new Error('Formatter checksum mismatch');
  const sources = (await files(join(component, 'java/src'))).filter((path) => path.endsWith('.java'));
  await run('java-format', javaTool('java'), [
    '-jar',
    formatter,
    ...(values.format ? ['--replace'] : ['--dry-run', '--set-exit-if-changed']),
    ...sources,
    join(root, 'scripts/java-analysis/JavacBaseline.java'),
    join(root, 'scripts/java-analysis/VerifyResources.java'),
  ]);
  await run('rust-format', 'cargo', [
    'fmt',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--all',
    ...(values.format ? [] : ['--', '--check']),
  ]);
  if (!values.format) {
    for (const path of await files(resources))
      if (path.endsWith('.json')) {
        const data = await readFile(path);
        new TextDecoder('utf-8', { fatal: true }).decode(data);
        if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) throw new Error('Resource BOM: ' + path);
      }
    await run('rust-clippy', 'cargo', [
      'clippy',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '-p',
      'pyxis-java-analysis',
      '--all-targets',
      '--',
      '-D',
      'warnings',
    ]);
    await run('rust-tests', 'cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '-p', 'pyxis-java-analysis']);
    await run('rust-release', 'cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '-p', 'pyxis-java-analysis', '--release']);
  }
}
