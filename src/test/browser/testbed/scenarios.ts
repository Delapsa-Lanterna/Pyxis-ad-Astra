import { createBrowserModel } from '../model';
import type { ScenarioOptions } from '../contracts';
import { performanceScenarios } from '../../../../scripts/browser/testbed/scenarios.mjs';
import { immersiveFiles, samplePng } from '../../../../scripts/shared/performance-samples.mjs';
import defaults from '../../../../schemas/spec-defaults.json';
import { createWorkspaceProject } from '../project';
import { gameRoot, gameImages } from '../sample-data';
import { resourceImage } from '../../fixtures/resources';
export { performanceScenarios };
export function createScenario(options: ScenarioOptions, session = 'browser-sample') {
  const definition = performanceScenarios.find(({ id }) => id === options.scene);
  const catalog = ['weapons', 'wings', 'hullmods'].find((kind) => kind === options.scene) as 'weapons' | 'wings' | 'hullmods' | undefined;
  const generated = (definition?.immersive || catalog) && !options.resourceSize;
  const root = gameRoot + '/mods/performance_' + options.scene;
  if (generated) gameImages.set(root + '/graphics/sample.png', 'data:image/png;base64,' + samplePng);
  const model = generated
    ? createWorkspaceProject(
        root,
        0,
        new Map(
          [...immersiveFiles(defaults, definition?.immersive ? options.count : 0, catalog, options.count)].map(([path, text]) => [
            root + '/' + path,
            text,
          ]),
        ),
      ).model
    : createBrowserModel(options.scene, options.count, session, options.resourceSize);
  model.scene = options.scene;
  model.count = options.count;
  if (options.resourceSize) model.resourceDataUrl = (path) => resourceImage(options.resourceSize, path);
  model.saveSettings({
    ...model.settings,
    theme: options.theme,
    accent: options.accent ?? 'blue',
    customAccent: options.customAccent ?? '#2563eb',
    editMode: ['fields', 'resources', 'feedback'].includes(options.scene) ? 'smart' : 'plain',
    performanceMonitorEnabled: options.monitor,
    ...(generated ? { ignoreEditorWarnings: true, immersiveGameFont: false } : {}),
  });
  if (options.source && options.source !== 'mod') {
    const catalog = model.catalog;
    model.catalog = (kind) =>
      catalog(kind).map((entry, index) => {
        if (options.source === 'core' || index % 2) entry.source.source = 'core';
        return entry;
      });
  }
  return model;
}
export function releaseScenario(model: ReturnType<typeof createScenario>) {
  gameImages.delete(model.manifest.modRoot + '/graphics/sample.png');
}
