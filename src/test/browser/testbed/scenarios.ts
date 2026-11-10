import { createBrowserModel } from '../model';
import type { ScenarioOptions } from '../contracts';
import { performanceScenarios } from '../../../../scripts/browser/testbed/scenarios.mjs';
export { performanceScenarios };
export function createScenario(options: ScenarioOptions, session = 'browser-sample') {
  const model = createBrowserModel(options.scene, options.count, session, options.resourceSize);
  model.saveSettings({
    ...model.settings,
    theme: options.theme,
    accent: options.accent ?? 'blue',
    customAccent: options.customAccent ?? '#2563eb',
    editMode: ['fields', 'resources', 'feedback'].includes(options.scene) ? 'smart' : 'plain',
    performanceMonitorEnabled: options.monitor,
  });
  if (options.source && options.source !== 'mod')
    for (const kind of ['weapons', 'wings', 'hullmods'] as const)
      model.catalog(kind).forEach((entry, index) => {
        if (options.source === 'core' || index % 2) entry.source.source = 'core';
      });
  return model;
}
