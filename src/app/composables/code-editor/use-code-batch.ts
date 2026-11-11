import { onScopeDispose } from 'vue';
import { EditorState, Transaction } from '@codemirror/state';
import type { CodeDocument, CodeDocumentGroup } from './use-code-document';
import type { useCodeEditor } from './use-code-editor';
import { beginSavedWrite, settleSavedContent } from '@/orchestrators/project-sync.orchestrator';
import { loadTextFile, saveTextBatch } from '@/services/text-editor.service';
import { withFileTargets } from '@/orchestrators/window-identity.orchestrator';
import { displayOffset, readTextContent, sameTextContent, writeTextContent } from '@/shared/runtime/text-document';
import { normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { AppError } from '@/shared/lib/errors';
import type { JavaAssistance } from '@/shared/types';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import { useSettingsStore } from '@/stores/settings.store';

export function useCodeBatch(host: ReturnType<typeof useCodeEditor>, owner: { sessionId: string; modRoot: string }) {
  const settings = useSettingsStore();
  const members = new Map<CodeDocument, string>();
  const closedBoundary = new Map<CodeDocument, EditorState['doc']>();
  type Snapshot = Map<CodeDocument, { state: EditorState; path: string }>;
  const undoStack: { before: Snapshot; after: Snapshot }[] = [],
    redoStack: typeof undoStack = [];
  let pending: Promise<DocumentSaveResult> | undefined;
  const error = (message: string) => new AppError(message, { action: 'code-edit-batch' });
  const capture = (): Snapshot =>
    new Map([...members].map(([document, path]) => [document, { state: document.document.state.value, path }]));
  function restore(snapshot: Snapshot) {
    for (const [document, saved] of snapshot) {
      document.document.restoreState(saved.state);
      members.set(document, saved.path);
      document.pendingPath.value = saved.path === document.session.currentTarget.value?.path ? null : saved.path;
    }
  }
  function history(document: CodeDocument, backwards: boolean) {
    const stack = backwards ? undoStack : redoStack,
      entry = stack.at(-1);
    if (!entry) {
      if (closedBoundary.get(document)?.eq(document.document.state.value.doc))
        throw error('整批操作的关联文件已关闭，请重新打开文件后生成修改');
      return false;
    }
    const expected = backwards ? entry.after : entry.before;
    if (!expected.get(document)?.state.doc.eq(document.document.state.value.doc)) return false;
    if (
      pending ||
      [...expected].some(([file, saved]) => !host.documents.includes(file) || !saved.state.doc.eq(file.document.state.value.doc))
    )
      throw error('关联文件已继续编辑，请先撤销后续修改再撤销整批操作');
    stack.pop();
    restore(backwards ? entry.before : entry.after);
    (backwards ? redoStack : undoStack).push(entry);
    return true;
  }
  function discard() {
    for (const [document] of members) {
      document.session.resetDraft();
      document.pendingPath.value = null;
      document.group.value = null;
    }
    members.clear();
    closedBoundary.clear();
    undoStack.length = 0;
    redoStack.length = 0;
  }
  function save(): Promise<DocumentSaveResult> {
    if (pending) return pending;
    pending = submit().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  async function submit(): Promise<DocumentSaveResult> {
    for (const document of members.keys()) if ((await document.session.inputs.commit()) === false) return { status: 'cancelled' };
    const captured = [...members].map(([document, path]) => ({
      document,
      path,
      source: document.session.currentTarget.value!.path,
      content: document.document.content.value,
      baseline: document.session.baselineSnapshot.value!,
    }));
    if (!captured.some(({ document, source, path }) => document.session.dirty.value || normalizeFsPath(source) !== normalizeFsPath(path)))
      return { status: 'noop' };
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
                  document.pendingPath.value = null;
                  if (normalizeFsPath(document.path.value) !== normalizeFsPath(path)) throw error('批次保存身份接纳失败');
                }
              },
            ],
          );
          const receipt = await operation.result;
          await settleSavedContent(owner.modRoot);
          return { status: 'saved', receipt };
        } finally {
          for (const { document } of captured) document.session.saving.value = false;
        }
      },
    );
  }
  async function apply(plan: JavaAssistance, validate: () => Promise<unknown>) {
    const selected: { document: CodeDocument; change: JavaAssistance['files'][number] }[] = [];
    for (const change of plan.files) {
      if (!pathBelongsToRoot(change.file, owner.modRoot) || (change.target && !pathBelongsToRoot(change.target, owner.modRoot)))
        throw error('修改包含只读引用来源');
      let document = host.documents.find((file) => normalizeFsPath(file.path.value) === normalizeFsPath(change.file));
      if (!document) {
        const disk = await loadTextFile(owner.sessionId, owner.modRoot, change.file);
        if (disk.text !== change.source) throw error('来源已变化，请重新生成修改');
        await host.openFiles([{ path: change.file }]);
        document = host.documents.find((file) => normalizeFsPath(file.path.value) === normalizeFsPath(change.file))!;
      }
      await document.document.waitForInput();
      if (
        document.readOnly ||
        document.session.hasPendingExternalValue.value ||
        !sameTextContent(document.document.content.value, readTextContent(change.source))
      )
        throw error('草稿已变化，请重新生成修改');
      selected.push({ document, change });
    }
    await validate();
    if (pending) await pending;
    for (const { document, change } of selected)
      if (
        document.session.hasPendingExternalValue.value ||
        !sameTextContent(document.document.content.value, readTextContent(change.source))
      )
        throw error('草稿已变化，请重新生成修改');
    for (const { document } of selected) members.set(document, members.get(document) ?? document.path.value);
    const before = capture();
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
      if (change.target) {
        members.set(document, change.target);
        document.pendingPath.value = change.target;
      }
    }
    undoStack.push({ before, after: capture() });
    undoStack.splice(0, Math.max(0, undoStack.length - settings.editHistoryLimit));
    redoStack.length = 0;
    for (const document of members.keys()) {
      const group: CodeDocumentGroup = {
        release: () => {
          members.delete(document);
          document.group.value = null;
          undoStack.length = 0;
          redoStack.length = 0;
          closedBoundary.delete(document);
          for (const file of members.keys()) closedBoundary.set(file, file.document.state.value.doc);
        },
        capture: () => {
          const snapshot = capture();
          return () =>
            [...snapshot].every(([file, saved]) => host.documents.includes(file) && saved.state.doc.eq(file.document.state.value.doc));
        },
        save,
        wait: () =>
          pending
            ? pending.then(
                () => true,
                () => false,
              )
            : Promise.resolve(true),
        undo: () => history(document, true),
        redo: () => history(document, false),
        discard,
      };
      document.group.value = group;
    }
  }
  onScopeDispose(() => {
    members.clear();
    undoStack.length = 0;
    redoStack.length = 0;
  });
  return { apply };
}
