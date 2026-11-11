import { computed, onScopeDispose, shallowReactive, shallowRef } from 'vue';
import { createTextFile, type TextFile } from '@/app/composables/text-file-editing/use-text-file';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { committedFileText } from '@/domain/project-sync/committed-text';
import { listenSavedContent, sessionContentUpdate } from '@/orchestrators/project-sync.orchestrator';
import { loadTextFile } from '@/services/text-file-editing.service';
import { errorDiagnosticOf } from '@/shared/lib/errors';
import { isAbsoluteFsPath, joinRootRelativePath, normalizeFsPath, pathBelongsToRoot, relativePathFromRoot } from '@/shared/lib/paths';
import { readTextContent } from '@/shared/runtime/text-document';
import { tabLabel } from '@/domain/text-file-editing/file-tabs';
import type { TextFileOpen, TextFileOpenResult, FileTextTarget, CommittedWriteEvent } from '@/shared/types';

export function useTextFiles(owner: Pick<FileTextTarget, 'sessionId' | 'modRoot'>) {
  const feedback = useAppFeedback();
  const commands = useSaveCommandStore();
  const documents = shallowReactive<TextFile[]>([]);
  const active = shallowRef<TextFile | null>(null);
  const location = shallowRef<TextFileOpen | null>(null);
  let disposed = false;
  let queue: Promise<void> = Promise.resolve();
  const opening = new Set<TextFile>();
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = queue.then(operation);
    // The caller owns failure feedback; the queue continues with the next request.
    queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
  function locate(document: TextFile, file: TextFileOpen) {
    if (file.line !== undefined) document.document.locate(file.line, file.column);
  }
  async function openFiles(files: TextFileOpen[]) {
    const results: TextFileOpenResult[] = [];
    let selected: { document: TextFile; file: TextFileOpen } | null = null;
    for (const file of files) {
      if (disposed) break;
      let document = documents.find((entry) => normalizeFsPath(entry.path.value) === normalizeFsPath(file.path));
      try {
        if (!document) {
          document = createTextFile(owner, file.path);
          opening.add(document);
          try {
            await document.load();
          } finally {
            opening.delete(document);
          }
          if (disposed) {
            document.dispose();
            break;
          }
          const existing = documents.find((entry) => normalizeFsPath(entry.path.value) === normalizeFsPath(document!.path.value));
          if (existing) {
            document.dispose();
            document = existing;
          } else documents.push(document);
        }
        locate(document, file);
        selected = { document, file };
        results.push({ path: document.path.value, diagnostic: null });
      } catch (error) {
        if (document && !documents.includes(document)) document.dispose();
        results.push({ path: file.path, diagnostic: errorDiagnosticOf(error) });
      }
    }
    if (selected && !disposed) {
      active.value = selected.document;
      location.value = { ...selected.file };
    }
    return results;
  }
  async function save(document = active.value) {
    if (!document) return true;
    const result = await document.save();
    return result.status !== 'cancelled';
  }
  async function saveAll() {
    const results = await Promise.all([...documents].map((document) => save(document)));
    return results.every(Boolean);
  }
  function close(document: TextFile) {
    return serialize(async () => {
      if (!(await commands.waitForParticipant(document.participant))) return;
      const dirty = () => document.dirty.value || !!document.group.value?.dirty();
      if (dirty()) {
        const before = document.session.draftValue.value;
        const path = document.path.value;
        const unchanged = document.group.value?.capture();
        const choice = await feedback.choose({
          title: '关闭文件？',
          content:
            (document.group.value?.paths() ?? [document.path.value]).join('\n') + '\n保存或放弃操作将共同处理以上文件的全部未保存修改。',
          choices: [
            { label: '保存并关闭', value: 'save', type: 'primary' },
            { label: '放弃修改并关闭', value: 'discard', type: 'warning' },
          ],
          cancelText: '继续编辑',
        });
        if (!choice || path !== document.path.value) return;
        if (unchanged && !unchanged()) return;
        if (choice === 'save' && (!(await save(document)) || dirty())) return;
        if (choice === 'discard' && before !== document.session.draftValue.value) return;
        if (choice === 'discard') document.group.value?.discard();
      }
      const index = documents.indexOf(document);
      if (index < 0 || disposed) return;
      document.group.value?.release();
      if (active.value === document) active.value = documents[index + 1] ?? documents[index - 1] ?? null;
      documents.splice(index, 1);
      document.dispose();
    });
  }
  function move(document: TextFile, target: TextFile, after: boolean) {
    if (document === target) return;
    documents.splice(documents.indexOf(document), 1);
    documents.splice(documents.indexOf(target) + Number(after), 0, document);
  }
  async function changed(event: CommittedWriteEvent) {
    const update = sessionContentUpdate(event, owner.sessionId);
    if (!update || disposed) return;
    for (const document of [...documents]) {
      if (document.readOnly) continue;
      try {
        const target = document.session.currentTarget.value!;
        const renamed = update.invalidation.renames?.find(([before]) => pathBelongsToRoot(target.path, before));
        if (renamed) {
          const [before, after] = renamed;
          const path =
            normalizeFsPath(before) === normalizeFsPath(target.path)
              ? after
              : joinRootRelativePath(after, relativePathFromRoot(before, target.path));
          if (document.session.dirty.value) {
            const choice = await feedback.choose({
              title: '跟随文件改名？',
              content: `${target.path}\n${path}\n跟随后保留当前文本。`,
              choices: [{ label: '保留文本并跟随', value: 'follow', type: 'primary' }],
              cancelText: '稍后处理',
            });
            if (choice !== 'follow') continue;
          }
          const loaded = await loadTextFile(owner.sessionId, owner.modRoot, path);
          if (!disposed && documents.includes(document))
            document.session.adoptIdentity(
              target,
              {
                target: { ...target, path: loaded.path },
                value: readTextContent(loaded.text),
                baseVersions: loaded.baseVersions,
                meta: { entity: loaded.entity, receipt: null },
              },
              (draft) => (document.session.dirty.value ? draft : readTextContent(loaded.text)),
              'identity',
            );
          document.problem.value = null;
          continue;
        }
        if (event.reason !== 'refresh' && !document.session.acceptsSaveDelivery(target, event.result.requestId)) continue;
        const text = event.reason === 'refresh' ? undefined : committedFileText(event.result, target.path);
        if (
          text !== undefined &&
          event.result.baseVersions.some((version) => normalizeFsPath(version.path) === normalizeFsPath(target.path))
        ) {
          document.session.applyExternalForTarget(
            {
              target,
              value: readTextContent(text),
              baseVersions: event.result.baseVersions,
              requestId: event.result.requestId,
              meta: { entity: document.session.baselineSnapshot.value!.meta.entity, receipt: null },
            },
            true,
          );
        } else if (
          update.invalidation.session ||
          update.invalidation.paths.some((path) =>
            pathBelongsToRoot(target.path, isAbsoluteFsPath(path) ? path : joinRootRelativePath(owner.modRoot, path)),
          )
        ) {
          await document.session.refreshTarget(target, true);
        }
        document.problem.value = null;
      } catch (error) {
        if (!disposed && documents.includes(document)) document.problem.value = errorDiagnosticOf(error);
      }
    }
  }
  let stop: (() => void) | undefined;
  const ready = listenSavedContent(
    (event) => [() => changed(event)],
    (session) => {
      if (session === owner.sessionId) for (const doc of documents) doc.session.cancelRead();
    },
  ).then(async (unlisten) => {
    if (disposed) {
      unlisten();
      return;
    }
    stop = unlisten;
  });
  const activeSave = () => save().then(() => {});
  commands.registerActiveSaveHandler(activeSave);
  onScopeDispose(() => {
    disposed = true;
    stop?.();
    commands.unregisterActiveSaveHandler(activeSave);
    active.value = null;
    for (const document of [...documents.splice(0), ...opening]) document.dispose();
    opening.clear();
  });
  return {
    isDisposed: () => disposed,
    documents,
    active,
    activate: (path: string) => {
      active.value = documents.find((file) => normalizeFsPath(file.path.value) === normalizeFsPath(path))!;
    },
    location,
    ready,
    settle: () => queue,
    openFiles: (files: TextFileOpen[]) => serialize(() => openFiles(files)),
    openSnapshot: (path: string, source: string) =>
      serialize(async () => {
        if (disposed) return null;
        let document = documents.find((entry) => normalizeFsPath(entry.path.value) === normalizeFsPath(path));
        if (!document) {
          document = createTextFile(owner, path, source);
          await document.load();
          documents.push(document);
        }
        active.value = document;
        return document;
      }),
    save,
    saveAll,
    close,
    move,
    dirty: computed(() => documents.some((document) => document.dirty.value)),
    label: (document: TextFile) =>
      tabLabel(
        document.path.value,
        documents.map((entry) => entry.path.value),
        owner.modRoot,
      ),
    loadExternal(document: TextFile) {
      useFieldInputActions(document.session.inputs, feedback).confirmDiscard(
        () => document.session.loadPendingExternal(),
        document.session.dirty.value,
        () => document.session.currentTargetKey.value,
        [document.path.value],
      );
    },
  };
}
