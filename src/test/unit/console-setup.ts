/// <reference types="node" />
import { afterAll, afterEach } from 'vitest';
import { format } from 'node:util';

const originalConsole = { warn: console.warn, error: console.error };
const diagnostics: Error[] = [];

// Direct assignments keep interception active when tests restore their mocks.
for (const method of ['warn', 'error'] as const) {
  console[method] = (...args: unknown[]) => {
    originalConsole[method](...args);
    diagnostics.push(new Error(`console.${method}: ${format(...args)}`));
  };
}

function checkConsole() {
  const errors = diagnostics.splice(0);
  if (errors.length) throw new AggregateError(errors, errors.map((error) => error.message).join('\n'));
}

afterEach(checkConsole);
afterAll(() => {
  Object.assign(console, originalConsole);
  checkConsole();
});
