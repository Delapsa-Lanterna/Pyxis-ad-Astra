import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import { ChangeSet, type Extension } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, keymap } from '@codemirror/view';
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
import { errorDiagnosticOf } from '@/shared/lib/errors';
import { normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import type { JavaInspection, JavaLocation, JavaQueryPurpose, JavaAssistPurpose } from '@/shared/types';
import type { useCodeEditor } from './use-code-editor';
import type { CodeDocument } from './use-code-document';
import { listenSavedContent } from '@/orchestrators/project-sync.orchestrator';
import { debugLog, recordQueuedLog } from '@/shared/runtime/app-log-queue';

export function useCodeAnalysis(host: ReturnType<typeof useCodeEditor>, modRoot: string, roots?: Readonly<Ref<string[]>>) {
  const status = shallowRef('打开 Java 文件后启动分析'),
    problem = shallowRef(''),
    results = shallowRef(new Map<CodeDocument, JavaInspection>());
  const locations = shallowRef<JavaLocation[]>([]),
    detail = shallowRef('');
  const versions = new Map<string, number>();
  const tracked = new Map<CodeDocument, { source: TextContent; changes: ChangeSet; path: string; full: boolean; stop: () => void }>();
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
  const java = (document: CodeDocument) =>
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
    clearTimeout(timer);
    const batch = [];
    for (const [document, entry] of tracked) {
      await document.document.waitForInput();
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
    return serialize(async () => {
      if (!available) return null;
      await flush();
      if (document.path.value !== file) return null;
      const source = document.document.content.value;
      if (position !== undefined && captured !== source) return null;
      const offset = sourceOffset(source, position ?? document.document.state.value.selection.main.from);
      const result = await inspectJavaEditor(file, offset, purpose);
      return !disposed &&
        host.active.value === document &&
        document.path.value === file &&
        source === document.document.content.value &&
        [...tracked.values()].every((pending) => !pending.full && pending.changes.empty)
        ? result
        : null;
    }).catch((error) => {
      fail(error);
      return null;
    });
  }
  async function locate(location: JavaLocation) {
    if (disposed) return;
    let document = host.documents.find((file) => normalizeFsPath(file.path.value) === normalizeFsPath(location.file));
    if (!document) {
      if (pathBelongsToRoot(location.file, modRoot)) {
        await host.openFiles([{ path: location.file }]);
        document = host.active.value ?? undefined;
      } else {
        if (!available) await start();
        if (!available || disposed) return;
        const result = await serialize(() => inspectJavaEditor(location.file, 0, 'source'));
        if (disposed) return;
        document = (await host.openSnapshot(location.file, result.source!)) ?? undefined;
        if (!document) return;
        const projection = await serialize(() => inspectJavaEditor(location.file, 0, 'document'));
        if (!disposed) results.value = new Map(results.value).set(document, projection);
      }
    }
    if (document) {
      host.active.value = document;
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
      captured = document.document.content.value;
    return serialize(async () => {
      if (!available) throw new Error('Java analysis is not ready');
      if (purpose !== 'validate') await flush();
      if ((position !== undefined && captured !== document.document.content.value) || file !== document.path.value) return null;
      const submitted = document.document.content.value;
      const result = await assistJavaEditor(
        file,
        sourceOffset(document.document.content.value, position ?? document.document.state.value.selection.main.from),
        purpose,
        name,
        choices,
        revision,
      );
      return submitted === document.document.content.value && host.active.value === document ? result : null;
    });
  }
  const diagnostics = computed(() => [...results.value.values()].flatMap((result) => result.diagnostics));
  let unlisten: (() => void) | undefined;
  void listenSavedContent(() => [
    async () => {
      if (available) {
        locations.value = [];
        detail.value = '';
        await serialize(refresh);
      }
    },
  ])
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(fail);
  const extensions = computed<Extension>(() => {
    const document = host.active.value,
      result = current.value;
    return [
      keymap.of([
        {
          key: 'F12',
          run: () => {
            void navigate('declaration').catch(fail);
            return true;
          },
        },
        {
          key: 'Shift-F12',
          run: () => {
            void navigate('references').catch(fail);
            return true;
          },
        },
      ]),
      hoverTooltip(async (_view, position) => {
        const result = await inspect('hover', position);
        return result?.binding
          ? {
              pos: position,
              create() {
                const dom = window.document.createElement('div');
                dom.textContent = signature(result);
                return { dom };
              },
            }
          : null;
      }),
      EditorView.decorations.of(
        Decoration.set(
          document && result
            ? result.diagnostics
                .map((diagnostic) => {
                  const from = displayOffset(document.document.content.value, diagnostic.start),
                    to = displayOffset(document.document.content.value, diagnostic.end);
                  return to > from
                    ? Decoration.mark({ class: `code-diagnostic-${diagnostic.severity}`, attributes: { title: diagnostic.message } }).range(
                        from,
                        to,
                      )
                    : null;
                })
                .filter((range) => range !== null)
                .sort((a, b) => a.from - b.from)
            : [],
        ),
      ),
    ];
  });
  onScopeDispose(() => {
    disposed = true;
    clearTimeout(timer);
    stopDocuments();
    unlisten?.();
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
    settle: () => queue,
  };
}
