import { onScopeDispose } from 'vue';
import { EditorState, Transaction } from '@codemirror/state';
import type { TextFile } from './use-text-file';
import type { TextFiles } from './text-files';
import type { TextFileEdits, FileVersion } from '@/shared/types';
import { beginSavedWrite, settleSavedContent } from '@/orchestrators/project-sync.orchestrator';
import { saveTextBatch } from '@/services/text-file-editing.service';
import { withFileTargets } from '@/orchestrators/window-identity.orchestrator';
import { displayOffset, readTextContent, sameTextContent, writeTextContent } from '@/shared/runtime/text-document';
import { normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { AppError } from '@/shared/lib/errors';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import { useSettingsStore } from '@/stores/settings.store';

export function useTextFileBatch(host: TextFiles, owner: { sessionId: string; modRoot: string }) {
  const settings = useSettingsStore();
  const closedBoundary = new Map<TextFile, EditorState['doc']>();
  type Snapshot = Map<TextFile, { state: EditorState; path: string }>;
  const undoStack: { before: Snapshot; after: Snapshot }[] = [],
    redoStack: typeof undoStack = [];
  const groups = new Map<TextFile, Set<TextFile>>();
  let pending: Promise<DocumentSaveResult> | undefined;
  let saving = new Set<TextFile>();
  const error = (message: string) => new AppError(message, { action: 'text-file-batch' });
  const capture = (files: Iterable<TextFile>): Snapshot =>
    new Map([...files].map((file) => [file, { state: file.document.state.value, path: file.path.value }]));
  function related(file: TextFile) {
    return new Set([file, ...(groups.get(file) ?? [])]);
  }
  function associate(files: Iterable<TextFile>) {
    const merged = new Set(files);
    for (const file of merged) for (const member of related(file)) merged.add(member);
    for (const file of merged) groups.set(file, merged);
  }
  function separate(files: Iterable<TextFile>) {
    for (const file of files) groups.delete(file);
  }
  function restore(snapshot: Snapshot) {
    for (const [file, saved] of snapshot) {
      file.document.restoreState(saved.state);
      file.pendingPath.value = saved.path === file.session.currentTarget.value?.path ? null : saved.path;
    }
    associate(snapshot.keys());
  }
  function history(file: TextFile, backwards: boolean) {
    if (closedBoundary.get(file)?.eq(file.document.state.value.doc)) throw error('整批操作的关联文件已关闭，请重新打开文件后生成修改');
    const stack = backwards ? undoStack : redoStack;
    const index = stack.findLastIndex((entry) => entry.before.has(file)),
      entry = stack[index];
    if (!entry) return false;
    const expected = backwards ? entry.after : entry.before;
    if (!expected.get(file)!.state.doc.eq(file.document.state.value.doc)) return false;
    if (
      pending ||
      [...expected].some(([member, saved]) => !host.documents.includes(member) || !saved.state.doc.eq(member.document.state.value.doc))
    )
      throw error('关联文件已继续编辑，请先撤销后续修改再撤销整批操作');
    stack.splice(index, 1);
    restore(backwards ? entry.before : entry.after);
    (backwards ? redoStack : undoStack).push(entry);
    return true;
  }
  function removeHistory(files: Set<TextFile>) {
    for (const stack of [undoStack, redoStack])
      for (let index = stack.length - 1; index >= 0; index--)
        if ([...stack[index]!.before.keys()].some((file) => files.has(file))) stack.splice(index, 1);
  }
  function discard(file: TextFile) {
    const files = related(file);
    for (const member of files) {
      member.session.resetDraft();
      member.pendingPath.value = null;
      member.group.value = null;
      closedBoundary.delete(member);
    }
    separate(files);
    removeHistory(files);
  }
  function save(file: TextFile): Promise<DocumentSaveResult> {
    if (pending) return saving.has(file) ? pending : pending.then(() => save(file));
    saving = related(file);
    pending = submit(saving).finally(() => {
      pending = undefined;
      saving = new Set();
    });
    return pending;
  }
  async function submit(files: Set<TextFile>): Promise<DocumentSaveResult> {
    for (const file of files) if ((await file.session.inputs.commit()) === false) return { status: 'cancelled' };
    const captured = [...files].map((document) => ({
      document,
      path: document.path.value,
      source: document.session.currentTarget.value!.path,
      content: document.document.content.value,
      baseline: document.session.baselineSnapshot.value!,
    }));
    if (!captured.some(({ document }) => document.dirty.value)) {
      separate(files);
      return { status: 'noop' };
    }
    const submitted = new Map([...files].map((file) => [file, groups.get(file)]));
    return withFileTargets(
      captured.flatMap(({ source, path }) => [source, path].map((path) => ({ ...owner, path }))),
      async () => {
        try {
          for (const { document } of captured) {
            document.document.separateHistory();
            document.session.saving.value = true;
          }
          const operation = beginSavedWrite(
            (request) =>
              saveTextBatch(
                {
                  ...owner,
                  baseVersions: captured.flatMap(({ baseline }) => baseline.baseVersions),
                  files: captured.map(({ source, path, content }) => ({
                    path: source,
                    target: path === source ? null : path,
                    text: writeTextContent(content),
                  })),
                },
                request,
              ),
            (result) => [
              () => {
                for (const { document, source, path, content, baseline } of captured) {
                  const value = result.changes.find((change) => normalizeFsPath(change.beforePath) === normalizeFsPath(source))?.afterText;
                  document.session.adoptIdentity(
                    baseline.target,
                    {
                      target: { ...owner, path },
                      value: value === undefined || value === null ? content : readTextContent(value),
                      baseVersions: result.baseVersions.filter((version) => normalizeFsPath(version.path) === normalizeFsPath(path)),
                      requestId: result.requestId,
                      meta: { ...baseline.meta, receipt: result },
                    },
                    (draft) => draft,
                    'save',
                  );
                  if (document.pendingPath.value === path) document.pendingPath.value = null;
                }
              },
            ],
          );
          const receipt = await operation.result;
          await settleSavedContent(owner.modRoot);
          for (const [file, group] of submitted) if (groups.get(file) === group) groups.delete(file);
          // Later input remains associated until all files of the captured operation are saved.
          if (captured.some(({ document }) => document.dirty.value)) associate(files);
          return { status: 'saved', receipt };
        } finally {
          for (const { document } of captured) document.session.saving.value = false;
        }
      },
    );
  }
  async function apply(plan: TextFileEdits, validate: () => Promise<unknown>) {
    const selected: {
      document: TextFile;
      change: TextFileEdits['files'][number];
      targetKey: string | null;
      path: string;
      baseVersions: readonly FileVersion[];
    }[] = [];
    for (const change of plan.files) {
      if (!pathBelongsToRoot(change.file, owner.modRoot) || (change.target && !pathBelongsToRoot(change.target, owner.modRoot)))
        throw error('修改包含只读引用来源');
      let document = host.documents.find((file) => normalizeFsPath(file.path.value) === normalizeFsPath(change.file));
      if (!document) {
        const results = await host.openFiles([{ path: change.file }]);
        if (results[0]?.diagnostic) throw new AppError(results[0].diagnostic.message, { cause: results[0].diagnostic });
        document = host.documents.find((file) => normalizeFsPath(file.path.value) === normalizeFsPath(change.file))!;
      }
      await document.document.waitForInput();
      if (
        document.readOnly ||
        document.session.hasPendingExternalValue.value ||
        !sameTextContent(document.document.content.value, readTextContent(change.source))
      )
        throw error('草稿已变化，请重新生成修改');
      selected.push({
        document,
        change,
        targetKey: document.session.currentTargetKey.value,
        path: document.path.value,
        baseVersions: document.session.baselineSnapshot.value!.baseVersions,
      });
    }
    if (pending) await pending;
    await validate();
    for (const { document, change, targetKey, path, baseVersions } of selected)
      if (
        !host.documents.includes(document) ||
        document.session.currentTargetKey.value !== targetKey ||
        document.path.value !== path ||
        !stableDeepEqual(document.session.baselineSnapshot.value?.baseVersions, baseVersions) ||
        document.session.hasPendingExternalValue.value ||
        !sameTextContent(document.document.content.value, readTextContent(change.source))
      )
        throw error('草稿已变化，请重新生成修改');
    const files = new Set(selected.map(({ document }) => document)),
      before = capture(files);
    for (const { document, change } of selected) {
      const content = document.document.content.value;
      document.document.separateHistory();
      document.document.dispatch(
        document.document.state.value.update({
          changes: change.edits.map((edit) => ({
            from: displayOffset(content, edit.from),
            to: displayOffset(content, edit.to),
            insert: edit.text,
          })),
          annotations: Transaction.userEvent.of('input.refactor'),
        }),
      );
      document.document.separateHistory();
      if (change.target) document.pendingPath.value = change.target;
    }
    associate(files);
    undoStack.push({ before, after: capture(files) });
    undoStack.splice(0, Math.max(0, undoStack.length - settings.editHistoryLimit));
    redoStack.length = 0;
    for (const file of files)
      file.group.value = {
        dirty: () => [...related(file)].some((member) => member.dirty.value),
        paths: () =>
          [...related(file)].map((member) =>
            member.pendingPath.value ? member.session.currentTarget.value!.path + ' → ' + member.pendingPath.value : member.path.value,
          ),
        release() {
          for (const stack of [undoStack, redoStack])
            for (const entry of stack)
              if (entry.before.has(file))
                for (const member of entry.before.keys()) if (member !== file) closedBoundary.set(member, member.document.state.value.doc);
          removeHistory(new Set([file]));
          separate(related(file));
          closedBoundary.delete(file);
          file.group.value = null;
        },
        capture() {
          const snapshot = capture(related(file));
          return () =>
            [...snapshot].every(
              ([member, saved]) =>
                host.documents.includes(member) && saved.path === member.path.value && saved.state.doc.eq(member.document.state.value.doc),
            );
        },
        save: () => save(file),
        wait: () =>
          pending
            ? pending.then(
                () => true,
                () => false,
              )
            : Promise.resolve(true),
        undo: () => history(file, true),
        redo: () => history(file, false),
        discard: () => discard(file),
      };
  }
  onScopeDispose(() => {
    closedBoundary.clear();
    groups.clear();
    undoStack.length = 0;
    redoStack.length = 0;
  });
  return { apply };
}
