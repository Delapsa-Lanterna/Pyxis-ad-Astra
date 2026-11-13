import type { JavaProjectAction, JavaProjectSnapshot, JavaDeployPreview } from '@/shared/types/java-project.types';
import type { createWorkspaceProject } from './project';

export function createJavaProjectPreview() {
  const entries = new Map<string, JavaProjectSnapshot>();
  function run(project: ReturnType<typeof createWorkspaceProject>, action: JavaProjectAction) {
    const root = project.manifest.modRoot;
    let entry = entries.get(root);
    if (!entry) {
      entry = {
        revision: 1,
        modRoot: root,
        version: '1',
        mode: root.endsWith('starsector-core') ? 'core' : 'manual',
        settings: { buildMode: 'manual', sources: null, libraries: [], primaryJar: null, gradle: null, project: null },
        sources: [root + '/src'],
        libraries: [],
        gameJars: [],
        artifacts: [],
        tasks: [],
        choices: [],
        selectedProject: null,
        sourceCount: [...project.textFiles.keys()].filter((path) => path.endsWith('.java')).length,
        missing: [],
        javaPath: 'M:/sample-game/jre/bin/java.exe',
        gradle: null,
        gradleError: null,
        target: '17',
        buildFiles: [],
        stale: false,
        configuration: 'preview-configuration',
        configurationError: null,
        primaryJar: null,
        deployTargets: [],
        active: false,
        phase: 'idle',
        operation: null,
        taskId: null,
        taskMode: 'manual',
        task: '',
        exitCode: null,
        output: '',
        locations: [],
        logPath: null,
        error: null,
        milliseconds: 0,
        build: null,
      };
      entries.set(root, entry);
    }
    if (action.kind === 'save') {
      entry.settings = action.settings;
    }
    entry.mode = root.endsWith('starsector-core') ? 'core' : entry.settings.buildMode;
    if (entry.mode === 'gradle' && project.textFiles.has(root + '/build.gradle')) {
      entry.gradle = { path: root + '/gradlew.bat', source: 'wrapper' };
      entry.buildFiles = [root + '/build.gradle'];
      entry.sources = [];
      entry.tasks = [
        { path: ':inspectAssets', group: 'assets', description: 'Inspect project assets' },
        { path: ':tools:writeIndex', group: null, description: 'Write an asset index' },
      ];
    }
    if (action.kind === 'save') {
      entry.settings = action.settings;
      entry.primaryJar = action.settings.primaryJar;
      entry.deployTargets = action.settings.primaryJar ? [action.settings.primaryJar] : [];
      entry.phase = 'succeeded';
      entry.sources = (action.settings.sources ?? ['src']).map((path) => (path.startsWith(root) ? path : root + '/' + path));
      entry.revision++;
    }
    if (action.kind === 'detect') {
      entry.taskMode = entry.settings.buildMode;
      entry.taskId = 'preview-detect';
      entry.task = '检测环境';
      entry.phase = 'succeeded';
      entry.output = entry.mode === 'gradle' ? 'Gradle 9.7.0' : 'java.specification.version = 17';
    }
    if (action.kind === 'build') {
      entry.taskMode = entry.settings.buildMode;
      entry.taskId = 'preview-build';
      entry.operation = action;
      entry.build = {
        mode: entry.settings.buildMode,
        id: 'preview-build',
        task: entry.mode === 'gradle' ? action.tasks.concat(action.arguments).join(' ') : 'javac + jar',
        milliseconds: 18,
        inputsChanged: false,
        artifacts:
          entry.mode === 'gradle'
            ? []
            : [{ id: 'preview-jar', path: root + '/tool-output/sample.jar', bytes: 842, fingerprint: 'preview-artifact' }],
      };
      entry.phase = 'succeeded';
      entry.task = entry.build.task;
      entry.exitCode = 0;
      entry.output = entry.mode === 'gradle' ? 'Completed: ' + entry.task : 'javac --release 17 -encoding UTF-8 -proc:none\njar --create';
      entry.revision++;
    }
    return entry;
  }
  return {
    run,
    preview(project: ReturnType<typeof createWorkspaceProject>, artifact: string, target: string): JavaDeployPreview {
      const source = entries.get(project.manifest.modRoot)!.build!.artifacts.find((entry) => entry.id === artifact)!;
      return {
        source,
        exists: false,
        targetBytes: 0,
        request: {
          sessionId: project.manifest.sessionId,
          modRoot: project.manifest.modRoot,
          artifact,
          target,
          baseVersions: [project.version(project.manifest.modRoot + '/' + target)],
        },
      };
    },
  };
}
