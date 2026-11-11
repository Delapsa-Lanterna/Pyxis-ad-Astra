import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { textSample, editedText } from '../../../../../scripts/shared/performance-samples.mjs';
import { createBrowserWorkspace } from '../../workspace-runtime';
import { createWorkspaceProject } from '../../project';
import { coreRoot, gameRoot } from '../../sample-data';
import { settled, until } from '../../timing';
import type { RoundResult, RunOptions } from '../../contracts';
import type { WindowRequestReceipt } from '@/shared/types';
import type { BrowserAppearanceState } from '../../BrowserAppearance.vue';

export function createEditorCase(element: HTMLElement, options: RunOptions) {
  const root = gameRoot + '/mods/editor_benchmark',
    fileBytes = options.fileBytes ?? 102400;
  const source = new Map([[root + '/mod_info.json', JSON.stringify({ id: 'editor_benchmark', name: 'Editor sample', version: '1' })]]);
  const workspace = createBrowserWorkspace(options.theme, () =>
    [coreRoot, root].map((path, index) => createWorkspaceProject(path, index, source)),
  );
  const project = workspace.projects[1]!,
    fileCount = options.scene === 'text-editor' ? 1 : options.count;
  const javaQueries = options.scene === 'java-queries';
  const files = Array.from({ length: fileCount }, (_, index) => ({
    path: root + '/measurement/File' + index + (javaQueries ? '.java' : '.txt'),
  }));
  for (const [index, file] of files.entries())
    project.textFiles.set(file.path, textSample(fileBytes, options.textShape ?? 'multiline', index));
  const original = project.textFiles.get(files.at(-1)!.path)!;
  project.write(null, { kind: 'text', path: root }, [], true);
  const owner = { sessionId: project.manifest.sessionId, modRoot: root };
  let label = '',
    opened = 0,
    closed = false;
  const frames = new Map<string, HTMLIFrameElement>();
  (window as Window & { browserWorkspace?: typeof workspace }).browserWorkspace = workspace;
  element.classList.add('browser-window-grid');
  function syncWindows() {
    for (const [key, entry] of workspace.windows)
      if (key !== 'main' && !frames.has(key)) {
        const frame = window.document.createElement('iframe');
        frame.dataset.window = key;
        frame.title = entry.context!.title;
        frame.src = import.meta.env.BASE_URL + '?window=' + encodeURIComponent(key);
        frames.set(key, frame);
        element.append(frame);
      }
    for (const [key, frame] of frames)
      if (!workspace.windows.has(key)) {
        frame.remove();
        frames.delete(key);
      }
  }
  const stopWindows = workspace.setWindowListener(syncWindows);
  const document = () => frames.get(label)!.contentDocument!;
  const view = () => EditorView.findFromDOM(document().querySelector<HTMLElement>('.cm-content')!)!;
  function button(name: string) {
    return [...document().querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === name)!;
  }
  async function open() {
    const settings = (await workspace.invoke('main', 'read_settings')) as { value: Record<string, unknown> };
    await workspace.invoke('main', 'save_settings', {
      payload: { settings: { ...settings.value, theme: options.theme, performanceMonitorEnabled: options.monitor } },
    });
    const began = performance.now();
    if (options.scene !== 'text-editor') {
      const opening = workspace.invoke('main', 'open_code_editor', { key: crypto.randomUUID(), input: { ...owner, files } });
      await until(() => workspace.windows.size === 2, '编辑窗口建立');
      label = [...workspace.windows.keys()].find((key) => key !== 'main')!;
      await opening;
    } else {
      const receipt = (await workspace.invoke('main', 'request_window', {
        payload: {
          identity: { type: 'text-editor', ...owner, path: files[0]!.path },
          title: 'Sample text',
          input: { kind: 'text-editor', location: { line: null, column: null, message: null, contextLabel: null, contextSeverity: null } },
          width: 1000,
          height: 700,
          minWidth: 500,
          minHeight: 400,
        },
      })) as WindowRequestReceipt;
      label = receipt.label;
    }
    await until(() => Boolean(frames.get(label)?.contentDocument?.querySelector('.cm-content')), '编辑文本就绪');
    await until(() => document().querySelector('footer,.text-editor-status')!.textContent!.includes('已保存'), '文档就绪');
    if (javaQueries) await until(() => document().querySelector('footer')!.textContent!.includes('Java 分析就绪'), 'Java 分析就绪');
    await settled();
    opened = performance.now() - began;
  }
  async function sample(iteration: number, phase: RoundResult['phase']): Promise<RoundResult> {
    const result: RoundResult = { iteration, phase, metrics: {}, assertions: [] };
    for (const key of workspace.windows.keys()) await workspace.emit('browser-measurement-ready', null, key);
    const before = workspace.calls.length;
    const began = performance.now();
    if (options.scene !== 'text-editor') document().querySelectorAll<HTMLElement>('[role=tab]')[iteration % fileCount]!.click();
    await settled();
    result.metrics.switch = performance.now() - began;
    const calls = workspace.calls.slice(before);
    result.metrics.ipc = calls.length;
    result.metrics.reads = calls.filter((call) => call.command === 'load_text_file').length;
    result.assertions.push({ name: '已载入文档切换使用内存', actual: calls.length, expected: 0, pass: calls.length === 0 });
    if (options.scene !== 'text-editor') {
      document().querySelectorAll<HTMLElement>('[role=tab]')[fileCount - 1]!.click();
      await settled();
    }
    const input = performance.now(),
      editor = view();
    editor.dispatch({ changes: { from: iteration % 2 ? editor.state.doc.length : 0, insert: '!' } });
    await settled();
    result.metrics.input = performance.now() - input;
    const saved = performance.now();
    button('保存').click();
    await until(() => document().querySelector('footer,.text-editor-status')!.textContent!.includes('已保存'), '保存完成');
    result.metrics.save = performance.now() - saved;
    if (project.textFiles.get(files.at(-1)!.path) !== editedText(original, iteration + 1))
      throw Error('Saved editor text differs from submitted text');
    if (javaQueries) Object.assign(result.metrics, await query());
    result.metrics.saveReads = workspace.calls.slice(before).filter((call) => call.command === 'load_text_file').length;
    result.assertions.push({
      name: '保存回执接纳所属文件',
      actual: result.metrics.saveReads,
      expected: 0,
      pass: result.metrics.saveReads === 0,
    });
    project.snapshots.length = 0;
    project.redos.length = 0;
    project.history.undoStack.length = 0;
    project.history.redoStack.length = 0;
    if (iteration === options.warmup + options.rounds - 1) {
      const history: { cycle: number; operation: string; step: number; milliseconds: number }[] = [];
      const heapPhases: { phase: string; usedJSHeapSize: number }[] = [];
      for (let cycle = 0; cycle < 3; cycle++)
        for (const [name, command] of [
          ['undo', undo],
          ['redo', redo],
        ] as const) {
          for (let step = 0; step < options.rounds; step++) {
            const began = performance.now();
            if (!command(editor)) throw Error('Editor history step unavailable: ' + name);
            await settled();
            const milliseconds = performance.now() - began;
            const remaining = name === 'undo' ? iteration - step : options.warmup + step + 1;
            if (editor.state.doc.toString() !== editedText(original, remaining)) throw Error('Editor history text differs: ' + name);
            history.push({ cycle, operation: name, step, milliseconds });
          }
          heapPhases.push({
            phase: name + '-' + cycle,
            usedJSHeapSize: (Reflect.get(performance, 'memory') as { usedJSHeapSize: number }).usedJSHeapSize,
          });
          result.assertions.push({ name: name + cycle + ' 文本结果', pass: true, actual: options.rounds, expected: options.rounds });
        }
      result.resources = { history, heapPhases };
    }
    return result;
  }
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (label && workspace.windows.has(label)) {
        const closing = workspace.invoke(label, 'request_close', { scope: { kind: 'window' } });
        await until(() => {
          if (!workspace.windows.has(label)) return true;
          const discard = [...document().querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find((button) =>
            button.textContent?.includes('放弃'),
          );
          discard?.click();
          return false;
        }, '编辑窗口释放');
        await closing;
      }
      const owners = (await workspace.invoke('main', 'query_edit_target_owners', {
        targets: files.map((file) => ({ ...owner, path: file.path })),
      })) as unknown[];
      if (owners.length || workspace.codeEditor.pending) throw Error('Editor targets or queued requests remain after close');
    } finally {
      stopWindows();
      for (const frame of frames.values()) frame.remove();
      frames.clear();
      element.classList.remove('browser-window-grid');
      project.textFiles.clear();
      project.snapshots.length = 0;
      project.redos.length = 0;
      delete (window as Window & { browserWorkspace?: typeof workspace }).browserWorkspace;
    }
  }
  async function query() {
    const metrics: Record<string, number> = {};
    const file = files[0]!.path,
      expected = view().state.doc.toString();
    const began = performance.now();
    await until(() => workspace.javaQueries.source(label, file) === expected, 'Java 草稿交接');
    metrics.update = performance.now() - began;
    for (const purpose of ['hover', 'references', 'complete', 'signature', 'imports', 'rename']) {
      const started = performance.now();
      const action = {
        kind: ['hover', 'references'].includes(purpose) ? 'inspect' : 'assist',
        file,
        offset: 0,
        purpose,
        name: purpose === 'rename' ? 'Changed' : null,
      };
      const result = await workspace.invoke(label, 'java_editor', { action });
      metrics[purpose] = performance.now() - started;
      metrics[purpose + 'Bytes'] = new TextEncoder().encode(JSON.stringify({ action, result })).byteLength;
    }
    await settled();
    await until(() => document().querySelector('footer')!.textContent!.includes('Java 分析就绪'), '分析查询释放');
    return metrics;
  }
  return {
    query,
    settings: workspace.appearance,
    async setAppearance(patch: Partial<BrowserAppearanceState>) {
      const settings = (await workspace.invoke('main', 'read_settings')) as { value: Record<string, unknown> };
      await workspace.invoke('main', 'save_settings', { payload: { settings: { ...settings.value, ...patch } } });
    },
    open,
    sample,
    close,
    workspace,
    get label() {
      return label;
    },
    get file() {
      return files.at(-1)!.path;
    },
    get openMilliseconds() {
      return opened;
    },
    get remainingDocuments() {
      return frames.size;
    },
  };
}
export type EditorCase = ReturnType<typeof createEditorCase>;
