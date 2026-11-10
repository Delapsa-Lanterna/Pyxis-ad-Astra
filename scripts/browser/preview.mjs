import { parseArgs } from 'node:util';
import { runBrowser } from './runtime.mjs';
import { verifyBrowserUI } from './preview/cases/ui.mjs';
import { verifyEditors } from './preview/cases/editors.mjs';
import { verifyJavaAnalysis } from './preview/cases/java-analysis.mjs';

const { values } = parseArgs({
  options: { scene: { type: 'string', default: 'all' }, url: { type: 'string' }, output: { type: 'string' } },
});
await runBrowser('preview', values, async ({ browser, newPage, artifacts }) => {
  const checks = [],
    errors = /** @type {string[]} */ ([]),
    scenes = [
      { id: 'workspace', run: async () => verifyBrowserUI(browser, values.url ?? 'http://127.0.0.1:1461', artifacts + '/workspace') },
      { id: 'editors', run: async () => verifyEditors((await newPage()).page, artifacts) },
      { id: 'java-analysis', run: async () => verifyJavaAnalysis((await newPage()).page, artifacts) },
    ];
  const selected = scenes.filter((scene) => values.scene === 'all' || values.scene === scene.id);
  if (!selected.length) throw Error('Unknown preview scene: ' + values.scene);
  for (const scene of selected) {
    try {
      const result = await scene.run();
      for (const check of result) checks.push({ name: scene.id + ': ' + JSON.stringify(check), pass: true });
    } catch (error) {
      const message = scene.id + ': ' + (error instanceof Error ? (error.stack ?? error.message) : String(error));
      errors.push(message);
      checks.push({ name: message, pass: false });
    }
  }
  return { checks, runs: [], errors };
});
