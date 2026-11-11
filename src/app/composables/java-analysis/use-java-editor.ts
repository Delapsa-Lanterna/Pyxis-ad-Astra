import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import { ChangeSet } from '@codemirror/state';
import { javaEditorExtensions } from './java-editor-extensions';
import { startJavaEditor, closeJavaEditor, syncJavaEditor, inspectJavaEditor } from '@/services/java-analysis.service';
import { assistJavaEditor } from '@/services/java-analysis.service';
import {
  displayOffset,
  sourceOffset,
  sourceSlice,
  writeTextContent,
  sameTextContent,
  type TextContent,
} from '@/shared/runtime/text-document';
import { AppError, errorDiagnosticOf } from '@/shared/lib/errors';
import { normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import type { JavaInspection, JavaLocation, JavaQueryPurpose, JavaAssistPurpose } from '@/shared/types';
import type { JavaEditorFile, JavaEditorFiles } from './java-editor-files';
import { debugLog, recordQueuedLog } from '@/shared/runtime/app-log-queue';

export function useJavaEditor(host: JavaEditorFiles, modRoot: string, roots?: Readonly<Ref<string[]>>) {
  const status = shallowRef('打开 Java 文件后启动分析'),
    problem = shallowRef(''),
    results = shallowRef(new Map<JavaEditorFile, JavaInspection>());
  const locations = shallowRef<JavaLocation[]>([]),
    detail = shallowRef('');
  const versions = new Map<string, number>();
  const tracked = new Map<JavaEditorFile, { source: TextContent; changes: ChangeSet; path: string; full: boolean; stop: () => void }>();
  let queue = Promise.resolve(),
    available = false,
    disposed = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  function serialize<T>(action: () => Promise<T>) {
    const work = queue.then(action);
    queue = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  function fail(error: unknown) {
    if (!disposed) {
      const diagnostic = errorDiagnosticOf(error);
      status.value = 'Java 分析失败';
      problem.value = diagnostic.message;
      recordQueuedLog({
        level: 'error',
        code: 'java_analysis.window_failed',
        message: diagnostic.message,
        path: diagnostic.location?.path ?? null,
        line: diagnostic.location?.line ?? null,
        fields: { modRoot, errorCode: diagnostic.code },
      });
    }
  }
  const java = (document: JavaEditorFile) =>
    /\.java$/i.test(document.path.value) && (!roots || roots.value.some((root) => pathBelongsToRoot(document.path.value, root)));
  function schedule() {
    clearTimeout(timer);
    if (available && !disposed)
      timer = setTimeout(() => {
        void serialize(refresh).catch(fail);
      }, 300);
  }
  const stopDocuments = watch(
    () => host.documents.filter(java),
    (documents) => {
      results.value = new Map([...results.value].filter(([file]) => documents.includes(file)));
      for (const document of documents) {
        if (document.readOnly || !java(document) || tracked.has(document)) continue;
        const entry = {
          source: document.document.content.value,
          changes: ChangeSet.empty(document.document.state.value.doc.length),
          path: document.path.value,
          full: true,
          stop: () => {},
        };
        entry.stop = watch(
          document.document.content,
          (_content, before) => {
            const transaction = document.document.transaction;
            if (!entry.full && transaction?.startState.doc === before.text && !transaction.changes.empty)
              entry.changes = entry.changes.compose(transaction.changes);
            else entry.full = true;
            if (results.value.size) results.value = new Map();
            locations.value = [];
            detail.value = '';
            schedule();
          },
          { flush: 'sync' },
        );
        tracked.set(document, entry);
      }
      for (const [document, entry] of tracked)
        if (!documents.includes(document)) {
          const baseline = document.session.pendingSnapshot.value ?? document.session.baselineSnapshot.value;
          entry.stop();
          tracked.delete(document);
          results.value = new Map([...results.value].filter(([file]) => file !== document));
          if (
            available &&
            baseline &&
            !host.isDisposed() &&
            (!sameTextContent(entry.source, baseline.value) || entry.path !== baseline.target.path)
          )
            void serialize(async () => {
              const version = (versions.get(entry.path) ?? 1) + 1;
              await syncJavaEditor([
                {
                  file: baseline.target.path,
                  previousFile: entry.path === baseline.target.path ? undefined : entry.path,
                  version,
                  source: writeTextContent(baseline.value),
                  edits: [],
                },
              ]);
              versions.set(baseline.target.path, version);
            }).catch(fail);
        }
      schedule();
    },
    { flush: 'sync', immediate: true },
  );
  async function flush() {
    const batch = [];
    for (const [document, entry] of tracked) {
      await document.document.waitForInput();
      if (disposed || !tracked.has(document)) continue;
      if (!entry.full && entry.changes.empty && entry.path === document.path.value) continue;
      const source = document.document.content.value,
        changes = entry.changes,
        full = entry.full || entry.path !== document.path.value;
      const edits: { from: number; to: number; text: string }[] = [];
      if (!full)
        changes.iterChanges((from, to, nextFrom, nextTo) =>
          edits.push({
            from: sourceOffset(entry.source, from),
            to: sourceOffset(entry.source, to),
            text: sourceSlice(source, nextFrom, nextTo),
          }),
        );
      const version = Math.max(versions.get(entry.path) ?? 1, versions.get(document.path.value) ?? 1) + 1;
      batch.push({
        document,
        entry,
        source,
        request: {
          file: document.path.value,
          previousFile: entry.path !== document.path.value ? entry.path : undefined,
          version,
          source: full ? writeTextContent(source) : null,
          edits,
        },
      });
      // New input starts a new change chain while this immutable submission is in flight.
      entry.source = source;
      entry.changes = ChangeSet.empty(source.text.length);
      entry.full = false;
      entry.path = document.path.value;
    }
    if (!batch.length) return;
    try {
      await syncJavaEditor(batch.map(({ request }) => request));
      for (const { request } of batch) versions.set(request.file, request.version);
    } catch (error) {
      for (const { entry } of batch) entry.full = true;
      throw error;
    }
  }
  async function refresh() {
    if (!available || disposed) return;
    status.value = '分析中';
    await flush();
    let revision: number | undefined;
    const entries = [...tracked].sort(([left], [right]) => Number(right === host.active.value) - Number(left === host.active.value));
    for (const [document, entry] of entries) {
      if (entry.full || !entry.changes.empty || entry.path !== document.path.value || !versions.has(entry.path)) continue;
      if (revision !== undefined && results.value.get(document)?.revision === revision) continue;
      const source = document.document.content.value;
      const result = await inspectJavaEditor(entry.path, 0, 'document');
      revision = result.revision;
      if (
        !disposed &&
        source === document.document.content.value &&
        tracked.has(document) &&
        [...tracked.values()].every((pending) => !pending.full && pending.changes.empty)
      )
        results.value = new Map(results.value).set(document, result);
      else debugLog('java_analysis.projection_discarded', () => ({ path: entry.path, revision: String(result.revision) }));
    }
    status.value = 'Java 分析就绪';
    problem.value = '';
  }
  let preparing: Promise<void> | undefined;
  function start() {
    if (preparing) return preparing;
    preparing = serialize(async () => {
      available = false;
      status.value = '准备 Java 分析';
      problem.value = '';
      await startJavaEditor();
      available = true;
      versions.clear();
      results.value = new Map();
      for (const entry of tracked.values()) {
        entry.full = true;
      }
      await refresh();
    })
      .catch(fail)
      .finally(() => {
        preparing = undefined;
      });
    return preparing;
  }
  function inspect(purpose: JavaQueryPurpose, position?: number) {
    const document = host.active.value;
    if (!document || !java(document)) return Promise.resolve(null);
    const file = document.path.value;
    const captured = document.document.content.value;
    const selected = position ?? document.document.state.value.selection.main.from;
    return serialize(async () => {
      if (
        !available ||
        disposed ||
        host.active.value !== document ||
        captured !== document.document.content.value ||
        document.path.value !== file
      )
        return null;
      await flush();
      if (document.path.value !== file) return null;
      const source = document.document.content.value;
      if (captured !== source || !host.documents.includes(document)) return null;
      const offset = sourceOffset(source, selected);
      const result = await inspectJavaEditor(file, offset, purpose);
      return !disposed &&
        host.active.value === document &&
        document.path.value === file &&
        source === document.document.content.value &&
        [...tracked.values()].every((pending) => !pending.full && pending.changes.empty)
        ? result
        : null;
    }).catch((error) => {
      if (host.active.value === document && captured === document.document.content.value && file === document.path.value) fail(error);
      return null;
    });
  }
  async function locate(location: JavaLocation) {
    if (disposed) return;
    let document = host.documents.find((file) => normalizeFsPath(file.path.value) === normalizeFsPath(location.file));
    if (!document) {
      if (pathBelongsToRoot(location.file, modRoot)) {
        const opened = await host.openFiles([{ path: location.file }]);
        if (opened[0]?.diagnostic) throw new AppError(opened[0].diagnostic.message, { cause: opened[0].diagnostic });
        document = host.documents.find((file) => normalizeFsPath(file.path.value) === normalizeFsPath(location.file));
      } else {
        if (!available) await start();
        if (!available || disposed) return;
        const result = await serialize(() => inspectJavaEditor(location.file, 0, 'source'));
        if (disposed) return;
        document = (await host.openSnapshot(location.file, result.source!)) ?? undefined;
        if (!document) return;
        const projection = await serialize(() => inspectJavaEditor(location.file, 0, 'document'));
        if (!disposed && host.documents.includes(document)) results.value = new Map(results.value).set(document, projection);
      }
    }
    if (document && host.documents.includes(document)) {
      host.activate(document.path.value);
      const offset = displayOffset(document.document.content.value, location.range.start),
        line = document.document.state.value.doc.lineAt(offset);
      document.document.locate(line.number, offset - line.from + 1);
    }
  }
  function navigate(purpose: 'declaration' | 'references') {
    return inspect(purpose).then(async (result) => {
      if (!result) return;
      locations.value = result.locations;
      detail.value = signature(result);
      if (purpose === 'declaration' && result.locations[0]) await locate(result.locations[0]);
    });
  }
  function signature(result: JavaInspection) {
    const binding = result.binding;
    return binding
      ? `${binding.type ?? ''} ${binding.owner ? binding.owner + '.' : ''}${binding.name}${binding.parameters ? '(' + binding.parameters.join(', ') + ')' : ''}${result.origin ? '\n' + result.origin : ''}`
      : '';
  }
  const current = computed(() => (host.active.value ? results.value.get(host.active.value) : undefined));
  function assist(
    purpose: JavaAssistPurpose,
    position?: number,
    name: string | null = null,
    choices: Record<string, string> = {},
    revision = 0,
  ) {
    const document = host.active.value;
    if (!document || !java(document)) return Promise.resolve(null);
    const file = document.path.value,
      captured = document.document.content.value,
      selected = position ?? document.document.state.value.selection.main.from;
    return serialize(async () => {
      if (!available) throw new Error('Java analysis is not ready');
      if (disposed || host.active.value !== document || captured !== document.document.content.value || file !== document.path.value)
        return null;
      if (purpose !== 'validate') await flush();
      if (captured !== document.document.content.value || file !== document.path.value || !host.documents.includes(document)) return null;
      const submitted = document.document.content.value;
      const result = await assistJavaEditor(
        file,
        sourceOffset(document.document.content.value, selected),
        purpose,
        name,
        choices,
        revision,
      );
      return !disposed &&
        file === document.path.value &&
        submitted === document.document.content.value &&
        host.active.value === document &&
        (purpose === 'validate' || [...tracked.values()].every((entry) => !entry.full && entry.changes.empty))
        ? result
        : null;
    });
  }
  const diagnostics = computed(() => [...results.value.values()].flatMap((result) => result.diagnostics));
  const extensions = computed(() =>
    javaEditorExtensions({ document: host.active.value, result: current.value, inspect, navigate, signature, fail }),
  );
  onScopeDispose(() => {
    disposed = true;
    clearTimeout(timer);
    stopDocuments();
    for (const entry of tracked.values()) entry.stop();
    tracked.clear();
    results.value = new Map();
    if (available || preparing) void serialize(closeJavaEditor).catch(fail);
  });
  return {
    status,
    problem,
    current,
    diagnostics,
    locations,
    detail,
    extensions,
    start,
    navigate,
    locate,
    assist,
    supports: java,
    isStarted: () => available || !!preparing,
    refresh: () => {
      locations.value = [];
      detail.value = '';
      return serialize(refresh);
    },
    settle: () => queue,
  };
}
