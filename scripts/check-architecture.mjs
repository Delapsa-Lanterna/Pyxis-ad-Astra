import { collectArchitectureContext } from './architecture/facts/context.mjs';
import { checkArchitecture } from './architecture/check.mjs';
import { formatDiagnostic } from './architecture/diagnostics.mjs';

const context = await collectArchitectureContext(process.cwd());
const diagnostics = checkArchitecture(context);
if (diagnostics.length) {
  console.error(diagnostics.map(formatDiagnostic).join('\n'));
  process.exitCode = 1;
} else console.log('Architecture check passed.');
