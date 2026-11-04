import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  cleanReports,
  cleanRuntime,
  environment,
  execute,
  outputRoot,
  projectRoot,
  runtimeRoot,
  serve,
  setup,
  toolRoot,
} from './runtime.mjs';

/** @param {string[]} args */
export async function main(args) {
  const [command, ...flags] = args;
  switch (command) {
    case 'setup':
      await setup(flags.includes('--graphify'), flags.includes('--dry-run'));
      break;
    case 'scan': {
      const { scan } = await import('./scan.mjs');
      await scan(
        projectRoot,
        {
          graphify: flags.includes('--graphify'),
          dryRun: flags.includes('--dry-run'),
          replayBaseline: flags.includes('--replay-baseline'),
        },
        {
          runtimeRoot,
          outputRoot: flags.includes('--baseline') ? join(outputRoot, 'baseline') : outputRoot,
        },
      );
      break;
    }
    case 'view': {
      const server = await serve(outputRoot);
      const address = server.address();
      console.log(`http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (address).port}/`);
      break;
    }
    case 'clean-runtime':
      await cleanRuntime(flags.includes('--dry-run'));
      break;
    case 'clean-reports':
      await cleanReports(flags.includes('--dry-run'));
      break;
    case 'check': {
      await mkdir(join(runtimeRoot, 'work/tmp'), { recursive: true });
      /** @type {[string, string | null, ...string[]][]} */
      const checks = [
        [
          'format',
          join(projectRoot, 'node_modules/prettier/bin/prettier.cjs'),
          '--config',
          join(projectRoot, '.prettierrc'),
          '--ignore-path',
          join(projectRoot, '.prettierignore'),
          '--check',
          'src',
          'test',
          'package.json',
          'tsconfig.json',
          'README.md',
        ],
        [
          'lint',
          join(projectRoot, 'node_modules/eslint/bin/eslint.js'),
          '.audit-tools/src',
          '.audit-tools/test',
          '--config',
          join(projectRoot, 'eslint.full.config.js'),
          '--max-warnings',
          '0',
        ],
        ['types', join(projectRoot, 'node_modules/typescript/bin/tsc'), '--noEmit'],
        ['tests', null, '--test', 'test/*.test.mjs'],
      ];
      for (const [name, script, ...parameters] of checks) {
        const result = await execute(process.execPath, script ? [script, ...parameters] : parameters, {
          cwd: name === 'lint' ? projectRoot : toolRoot,
          logs: join(runtimeRoot, 'logs/check'),
          name,
          env: environment(),
        });
        console.log(result.stdout);
      }
      break;
    }
    default:
      throw new Error(
        'Usage: audit.cmd setup [--graphify] | scan [--graphify] [--baseline] | view | check | clean-runtime [--dry-run] | clean-reports [--dry-run]',
      );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
