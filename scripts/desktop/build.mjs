import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { configPath, targetDirectory, executable, root, desktopConfiguration } from './config.mjs';

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' } } });
const cli = 'node_modules/@tauri-apps/cli/tauri.js';
const args = [cli, 'build', '--no-bundle', '--config', configPath];
if (values['dry-run'])
  console.log(JSON.stringify({ command: process.execPath, args, targetDirectory, executable, ...(await desktopConfiguration()) }));
else {
  const child = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    stdio: 'inherit',
    env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
  });
  child.once('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
