import type { ScenarioOptions } from '../contracts';
import { createWorkspaceProject } from '../project';
import { coreRoot, workspaceRoots } from './game-files';
import { gameCatalog } from '../queries';

export function createGamePreview(options: ScenarioOptions, mod?: string, id?: string) {
  const projects = [coreRoot, ...workspaceRoots].map((root, index) => createWorkspaceProject(root, index));
  projects.forEach((project) =>
    project.setSources(() =>
      project === projects[0]
        ? [project]
        : [project, ...projects.slice(1).filter((source) => source !== project && options.source === 'all'), projects[0]!],
    ),
  );
  const project = mod
    ? projects.find((entry) => entry.manifest.modInfo!.id === mod)!
    : options.scene === 'fields'
      ? projects[3]!
      : options.scene === 'skin'
        ? projects[2]!
        : projects[1]!;
  if (!project) throw Error('链接中的场景项目不存在：' + mod);
  const model = project.model;
  if (id) {
    const graph = model.graph;
    model.graph = (kind, targetId) => graph(kind, targetId ?? id);
    const context = model.windowContext;
    model.windowContext = (kind) => {
      const result = context(kind),
        snapshot = graph(kind, id);
      result.identity = { type: 'immersive', ...snapshot.root };
      result.input = {
        kind: 'immersive-editor',
        rowKey: kind === 'wing' ? project.tables.get('wings')!.rows.find((row) => row.data.id === id)!.rowKey : null,
      };
      return result;
    };
  }
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
