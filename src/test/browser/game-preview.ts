import type { ScenarioOptions } from './contracts';
import { createWorkspaceProject } from './game-project';
import { coreRoot, workspaceRoots } from './game-files';
import { gameCatalog } from './game-queries';

export function createGamePreview(options: ScenarioOptions) {
  const projects = [coreRoot, ...workspaceRoots].map(createWorkspaceProject);
  projects.forEach((project) =>
    project.setSources(() =>
      project === projects[0]
        ? [project]
        : [project, ...projects.slice(1).filter((source) => source !== project && options.source === 'all'), projects[0]!],
    ),
  );
  const project = options.scene === 'fields' ? projects[3]! : options.scene === 'skin' ? projects[2]! : projects[1]!,
    model = project.model;
  if (options.scene === 'fields') model.fieldHullId = 'Idoneus_flashghast';
  model.scene = options.scene;
  model.rows.push(...project.tables.get('ships')!.rows);
  model.header.splice(0, model.header.length, ...project.tables.get('ships')!.header);
  model.catalog = (kind) =>
    gameCatalog(project, kind).filter((entry) => !options.source || options.source === 'all' || entry.source.source === options.source);
  model.saveSettings({
    ...model.settings,
    theme: options.theme,
    accent: options.accent ?? 'blue',
    customAccent: options.customAccent ?? '#2563eb',
    editMode: ['fields', 'resources', 'feedback'].includes(options.scene) ? 'smart' : 'plain',
    performanceMonitorEnabled: options.monitor,
  });
  return model;
}
