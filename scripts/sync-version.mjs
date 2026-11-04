import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
const { version } = /** @type {{ version: string }} */ (JSON.parse(readFileSync('package.json', 'utf8')));

/** @type {Array<[string, (source: string) => string]>} */
const targets = [
  [
    'package-lock.json',
    (source) => {
      const lock = /** @type {{ version: string, packages: { '': { version: string } } }} */ (JSON.parse(source));
      lock.version = version;
      lock.packages[''].version = version;
      return JSON.stringify(lock, null, 2) + '\n';
    },
  ],
  ['src-tauri/Cargo.toml', (source) => source.replace(/(\[package\][\s\S]*?\nversion = ")[^"]+("\r?\n)/, `$1${version}$2`)],
  ['src-tauri/Cargo.lock', (source) => source.replace(/(name = "pyxis-ad-astra"\r?\nversion = ")[^"]+(")/, `$1${version}$2`)],
];

// Prepare every target before writing so a read failure leaves the version records intact.
const changes = targets
  .map(([path, transform]) => {
    const source = readFileSync(path, 'utf8');
    return { path, source, content: transform(source) };
  })
  .filter(({ source, content }) => source !== content);

for (const { path, content } of changes) {
  console.log(`${values['dry-run'] ? 'Would synchronize' : 'Synchronizing'} ${path} to ${version}`);
  if (!values['dry-run']) writeFileSync(path, content, 'utf8');
}
console.log(`Version ${version}: ${changes.length} file(s) ${values['dry-run'] ? 'planned' : 'synchronized'}.`);
