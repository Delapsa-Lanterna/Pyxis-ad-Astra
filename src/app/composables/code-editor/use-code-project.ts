import { computed, effectScope, onScopeDispose, shallowReactive, shallowRef } from 'vue';
import { useFileBrowser } from '@/app/composables/file-browser/use-file-browser';
import { createFileBrowserState } from '@/stores/file-browser.store';
import { queryCodeEditorSources } from '@/services/code-editor.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { listenSavedContent } from '@/orchestrators/project-sync.orchestrator';
import { errorDiagnosticOf } from '@/shared/lib/errors';
import { joinRootRelativePath } from '@/shared/lib/paths';
import type { CodeEditorSource, CodeEditorSources } from '@/shared/types';

export function useCodeProject(openFile: (path: string, readOnly: boolean) => Promise<unknown>) {
  const feedback = useAppFeedback(),
    reads = useQueryReadOwner();
  const sources = shallowRef<CodeEditorSources | null>(null),
    branches = shallowReactive<CodeProjectBranch[]>([]),
    searchText = shallowRef(''),
    problem = shallowRef('');
  const browseScroll = shallowRef(0),
    searchScroll = shallowRef(0);
  let disposed = false,
    stop: (() => void) | undefined,
    opening = Promise.resolve();
  function branch(source: CodeEditorSource) {
    const state = shallowReactive({ source, opened: !source.readOnly });
    const scope = effectScope();
    const browser = scope.run(() =>
      useFileBrowser(
        () => (state.opened ? state.source : null),
        (_target, path) => open(state.source, path),
        {
          state: createFileBrowserState(),
          directory: source.directory,
          prefetch: false,
          feedback,
          contextMenu: false,
          include: (entry) => !source.readOnly || entry.kind !== 'file' || /\.java$/i.test(entry.name),
        },
      ),
    )!;
    return Object.assign(state, { browser, release: () => scope.stop() });
  }
  function open(source: CodeEditorSource, path: string) {
    const work = opening.then(async () => {
      if (disposed) return;
      try {
        await openFile(joinRootRelativePath(source.modRoot, path).replaceAll('\\', '/'), source.readOnly);
      } catch (error) {
        if (!disposed) feedback.error(error, '打开文件失败');
      }
    });
    opening = work;
    return work;
  }
  async function refreshSources() {
    await reads.consume('sources', {}, queryCodeEditorSources, {
      ready(value) {
        const previous = new Map(branches.map((entry) => [entry.source.sessionId, entry]));
        const next = value.sources.map((source) => {
          const current = previous.get(source.sessionId);
          previous.delete(source.sessionId);
          if (current) {
            current.source = source;
            return current;
          }
          return branch(source);
        });
        for (const entry of previous.values()) entry.release();
        branches.splice(0, branches.length, ...next);
        sources.value = value;
        problem.value = '';
      },
      error: (error) => {
        problem.value = errorDiagnosticOf(error).message;
      },
    });
    await Promise.all(branches.map((entry) => entry.browser.ready));
  }
  async function search() {
    await Promise.all(branches.filter((entry) => entry.opened).map((entry) => entry.browser.actions.submitSearch()));
  }
  const ready = refreshSources();
  void listenSavedContent(() => [refreshSources])
    .then((release) => {
      if (disposed) release();
      else stop = release;
    })
    .catch((error) => feedback.error(error, '监听项目来源失败'));
  onScopeDispose(() => {
    disposed = true;
    stop?.();
    for (const entry of branches.splice(0)) entry.release();
  });
  return {
    sources,
    branches,
    problem,
    searchText,
    scrollTop: computed(() => (searchText.value.trim() ? searchScroll.value : browseScroll.value)),
    setScroll(top: number) {
      (searchText.value.trim() ? searchScroll : browseScroll).value = top;
    },
    ready,
    async toggle(entry: CodeProjectBranch) {
      entry.opened = !entry.opened;
      if (entry.opened) {
        await entry.browser.ready;
        entry.browser.actions.setSearch(searchText.value);
      }
    },
    async refresh() {
      await refreshSources();
      await Promise.all(branches.filter((entry) => entry.opened).map((entry) => entry.browser.actions.refresh()));
    },
    search,
    setSearch(value: string) {
      searchText.value = value;
      for (const entry of branches.filter((entry) => entry.opened)) entry.browser.actions.setSearch(value);
    },
    analysisRoots: computed<string[]>((previous) => {
      const roots = sources.value?.analysisRoots ?? [];
      return previous?.length === roots.length && previous.every((root, index) => root === roots[index]) ? previous : roots;
    }),
    settle: () => opening,
  };
}
export type CodeProjectBranch = {
  source: CodeEditorSource;
  opened: boolean;
  browser: ReturnType<typeof useFileBrowser>;
  release: () => void;
};
