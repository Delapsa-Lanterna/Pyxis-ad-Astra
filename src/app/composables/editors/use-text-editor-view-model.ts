import { releaseNativeWindowTargets } from '@/services/window.service';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { beginSavedWrite } from '@/orchestrators/project-sync.orchestrator';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import {
  refreshProjectSourcePaths,
  listenSavedIdentity,
  listenSavedContent,
  sessionContentUpdate,
} from '@/orchestrators/project-sync.orchestrator';
import { computed, ref, watch } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { loadTextFile, saveTextFile, followTextIdentity } from '@/services/text-editor.service';
import { committedFileText } from '@/domain/project-sync/committed-text';
import { isAbsoluteFsPath, joinRootRelativePath, normalizeFsPath, pathBelongsToRoot, relativePathFromRoot } from '@/shared/lib/paths';
import { useEditTargetDraftSession, type EditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { createTextDocument, readTextContent, sameTextContent, writeTextContent, type TextContent } from '@/shared/runtime/text-document';
import { useSettingsStore } from '@/stores/settings.store';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { retargetTextEditorWindow } from '@/orchestrators/window-identity.orchestrator';

import type { CommittedWriteEvent, TextWindowLocation } from '@/shared/types';
import type { EntityIdentityChange, WriteResult, EntityTargetSnapshot } from '@/shared/types';
import { formatError, errorDiagnosticOf, errorCodeOf, AppError } from '@/shared/lib/errors';
import { waitForRead } from '@/shared/runtime/read-request';

export interface TextEditorViewModelParams {
  mode: 'session' | 'recovery';
  filePath: string | null;
  modRoot: string | null;
  sessionId: string | null;
  title: string;
  line: number | null;
  column: number | null;
}

interface TextEditorTarget {
  filePath: string;
  mode: 'session' | 'recovery';
  modRoot: string;
  sessionId: string | null;
}

export function useTextEditorViewModel(params: TextEditorViewModelParams) {
  const settings = useSettingsStore();
  const feedback = useAppFeedback();
  const currentPath = ref(params.filePath);
  let pendingIdentity: {
    change?: EntityIdentityChange;
    nextPath: string;
    event: Pick<CommittedWriteEvent, 'sessionId' | 'modRoot' | 'result'>;
    target: TextEditorTarget;
    preserve: boolean;
  } | null = null;
  const identityNotice = ref('');
  let identitySequence = 0;
  type TextMeta = { entity: EntityTargetSnapshot | null; receipt: WriteResult<unknown> | null };

  const title = ref(params.title);
  const contextLabel = ref('错误');
  const contextSeverity = ref('error');
  const contextMessage = ref('');
  const targetLine = ref(normalizeEventLine(params.line));
  const targetColumn = ref(normalizeEventLine(params.column));
  const draftSession: EditTargetDraftSession<TextContent, TextEditorTarget, TextMeta> = useEditTargetDraftSession<
    TextContent,
    TextEditorTarget,
    TextMeta
  >({
    emptyValue: readTextContent(''),
    clone: (text) => text,
    equals: sameTextContent,
    mapSavedDraft: (draft) => draft,
    captureSave: () => document.separateHistory(),
    beginSave: beginSavedWrite,
    savedContent: (snapshot) => ({ ...snapshot, meta: { ...snapshot.meta, receipt: null } }),
    load: async (target, signal) => {
      try {
        const loaded = await waitForRead(loadTextFile(target.sessionId, target.modRoot, target.filePath), target, signal);
        signal!.throwIfAborted();
        contextMessage.value = '';
        return {
          target,
          value: readTextContent(loaded.text),
          baseVersions: loaded.baseVersions,
          meta: { entity: loaded.entity, receipt: null },
        };
      } catch (error) {
        if (!signal!.aborted) {
          contextMessage.value =
            errorCodeOf(error) === 'text.invalid_utf8'
              ? '无法读取文件：请选择文件当前使用的编码，将其转换为 UTF-8 后重试。'
              : formatError(error);
          feedback.error(error, '读取文件失败');
        }
        throw error;
      }
    },
    // Text saves write the file in place; entity identity is re-read like an external modification.
    save: async (target, draft, baseVersions, _original, request) => {
      const text = writeTextContent(draft);
      const result = await saveTextFile(target.sessionId, target.modRoot, target.filePath, text, baseVersions, request);
      return {
        target,
        value:
          typeof result.content?.value?.text === 'string' && result.content.value.text !== text
            ? readTextContent(result.content.value.text)
            : draft,
        baseVersions: result.baseVersions,
        meta: { entity: draftSession.baselineSnapshot.value!.meta.entity, receipt: result },
        requestId: result.requestId,
      };
    },

    acceptSaved: async (snapshot) => {
      const target = snapshot.target;
      if (target.sessionId) {
        if (snapshot.meta.entity) await retargetTextEditorWindow(target.sessionId, target.modRoot, target.filePath, title.value);
        await releaseNativeWindowTargets();
      }
    },

    targetKey: (target) => textEditorTargetKey(target),
  });
  watch(
    draftSession.baselineSnapshot,
    (snapshot) => {
      if (snapshot) {
        currentPath.value = snapshot.target.filePath;
        contextMessage.value = '';
      }
    },
    { flush: 'sync' },
  );
  const document = createTextDocument(
    draftSession.draftValue,
    draftSession.context,
    computed(() => settings.editHistoryLimit),
    draftSession.inputs,
    () => {
      if (pendingIdentity) void followPendingIdentity();
    },
  );
  const unregisterSave = useSaveCommandStore().registerSaveParticipant({
    targetKey: draftSession.currentTargetKey,
    modRoot: computed(() => params.modRoot),
    saving: draftSession.saving,
    waitForSave: draftSession.waitForSave,
    editing: {
      targets: computed(() => {
        const snapshot = draftSession.baselineSnapshot.value;
        return snapshot?.target.sessionId
          ? snapshot.baseVersions.map((version) => ({
              sessionId: snapshot.target.sessionId!,
              modRoot: snapshot.target.modRoot,
              path: version.path,
            }))
          : [];
      }),
      label: '文本编辑器',
      dirty: draftSession.dirty,
      draftSession: draftSession,
      captureContent: document.captureContent,
      save: async () => {
        const snapshot = await draftSession.saveDraft();
        return snapshot ? { status: 'saved', receipt: snapshot.meta.receipt! } : { status: 'cancelled' };
      },
    },
  });
  const { confirmDiscard } = useFieldInputActions(draftSession.inputs);
  let unlistenChanges: Awaited<ReturnType<typeof listenSavedContent>> | null = null;
  let unlistenIdentity: Awaited<ReturnType<typeof listenSavedIdentity>> | null = null;
  let disposed = false;

  const text = computed(() => writeTextContent(draftSession.draftValue.value));
  const dirty = draftSession.dirty;
  const lineCount = computed(() => draftSession.draftValue.value.text.lines);
  const canUndo = document.canUndo;
  const canRedo = document.canRedo;
  const isErrorContext = computed(() => contextSeverity.value === 'error' && contextMessage.value !== '');
  const isWarningContext = computed(() => contextSeverity.value === 'warning');
  const hasPendingExternalText = computed(() => draftSession.hasPendingExternalValue.value || identityNotice.value !== '');
  const externalTextNotice = computed(
    () => identityNotice.value || (draftSession.hasPendingExternalValue.value ? '外部文本已更新，当前未保存草稿已保留。' : ''),
  );

  let setup: Promise<void> | null = null;
  async function initialize() {
    await (setup ??= setupFile());
    if (draftSession.saving.value) await draftSession.waitForSave();
    if (!disposed) await loadFile();
  }
  async function setupFile() {
    disposed = false;
    if (disposed) return;
    if (disposed) return;
    unlistenIdentity = await listenSavedIdentity(handleIdentityApplied);
    if (disposed) {
      unlistenIdentity();
      unlistenIdentity = null;
      return;
    }
    unlistenChanges = await listenSavedContent(handleCommittedWriteEvent, (sessionId) => {
      if (sessionId === draftSession.currentTarget.value?.sessionId) draftSession.cancelRead();
    });
    if (disposed) unlistenChanges();
  }

  function dispose() {
    disposed = true;
    document.dispose();
    unregisterSave();
    unlistenIdentity?.();
    identitySequence++;
    pendingIdentity = null;
    draftSession.dispose();
    unlistenChanges?.();
    unlistenChanges = null;
  }

  async function loadFile() {
    const target = textEditorTarget();
    if (!target) throw new AppError('文件目标不可用', { action: 'accept-window' });
    if (draftSession.ready.value) await draftSession.refreshTarget(target);
    else await draftSession.loadTarget(target);
  }

  async function saveFile() {
    if (useProjectSyncStore().isWaiting(params.modRoot)) return;
    const target = textEditorTarget();
    if (!target) return;
    if (draftSession.saving.value) {
      await draftSession.waitForSave();
      return;
    }
    try {
      if (pendingIdentity) {
        await followPendingIdentity();
        if (pendingIdentity) {
          if (pendingIdentity.change)
            await followTextIdentity(pendingIdentity.change.after.kind, text.value, pendingIdentity.change.after.id);
          return;
        }
      }
      const saved = await draftSession.saveDraft();
      if (!saved || disposed) return;
      feedback.success('文件已保存', { paths: [target.filePath] });
    } catch (error) {
      const location = errorDiagnosticOf(error).location;
      if (location?.line) {
        targetLine.value = location.line;
        targetColumn.value = location.column ?? undefined;
        contextMessage.value = formatError(error);
        contextSeverity.value = 'error';
      }
      feedback.error(error, '保存文件失败');
    }
  }

  function cancelChanges() {
    if (draftSession.saving.value)
      void draftSession.waitForSave().then((saved) => {
        if (saved && !disposed) draftSession.resetDraft();
      });
    else draftSession.resetDraft();
  }

  useContextMenuScope({
    identity: () => draftSession.currentTargetKey.value ?? '',
    canRefresh: () => Boolean(currentPath.value),
    refresh: async (current) => {
      const target = textEditorTarget()!;
      if (target.sessionId) await refreshProjectSourcePaths(target.sessionId, target.modRoot, [target.filePath]);
      if (current()) await draftSession.refreshTarget(target);
    },
  });
  function loadPendingExternalText() {
    if (pendingIdentity) {
      void followPendingIdentity();
      return;
    }
    const key = draftSession.currentTargetKey.value;
    const adopt = () => {
      if (disposed || key !== draftSession.currentTargetKey.value) return;
      confirmDiscard(
        () => {
          draftSession.loadPendingExternal();
        },
        draftSession.dirty.value,
        () => draftSession.currentTargetKey.value,
        [draftSession.currentTarget.value!.filePath],
      );
    };
    if (draftSession.saving.value)
      void draftSession.waitForSave().then((saved) => {
        if (saved) adopt();
      });
    else adopt();
  }

  const updateText = document.replaceSource;

  async function handleIdentityApplied(event: CommittedWriteEvent) {
    const target = textEditorTarget();
    if (
      !target ||
      (target.sessionId !== event.sessionId && !sessionContentUpdate(event, target.sessionId)) ||
      normalizeFsPath(target.modRoot) !== normalizeFsPath(event.modRoot)
    )
      return;
    const reference = pendingIdentity?.nextPath ?? target.filePath;
    const change = event.result.identityChanges.find(
      (change) =>
        normalizeFsPath(change.before.write.path) === normalizeFsPath(reference) &&
        (change.before.write.path !== change.after.write.path || change.before.id !== change.after.id),
    );
    if (!change) return;
    if (disposed || textEditorTargetKey(target) !== draftSession.currentTargetKey.value) return;
    const preserve = draftSession.dirty.value;
    if (preserve && !pendingIdentity) {
      const choice = await feedback.choose({
        title: change.before.write.path === change.after.write.path ? '跟随文件中的 ID 修改？' : '跟随文件改名？',
        content:
          (change.before.write.path === change.after.write.path
            ? '这份文件中的实体 ID 已由 ' + change.before.id + ' 改为 ' + change.after.id + '。\n\n' + change.after.write.path
            : '当前文件已被重命名。\n\n原路径：\n' + change.before.write.path + '\n\n新路径：\n' + change.after.write.path) +
          '\n\n跟随后保留当前文本，按新的文件身份继续编辑。',
        choices: [{ label: '保留文本并跟随', value: 'follow', type: 'primary' }],
        cancelText: '稍后处理',
      });
      if (disposed || textEditorTargetKey(target) !== draftSession.currentTargetKey.value) return;
      if (choice !== 'follow')
        throw new AppError('文件身份交接尚未确认', { code: 'write.identity_pending', action: 'follow-saved-identity' });
    }
    pendingIdentity = { change, nextPath: change.after.write.path, event, target, preserve };
    await followPendingIdentity(true);
  }

  async function followPendingIdentity(required = false) {
    const pending = pendingIdentity;
    if (!pending) return;
    const sequence = ++identitySequence;
    const raw = text.value;
    try {
      const followed = pending.preserve
        ? pending.change
          ? await followTextIdentity(pending.change.after.kind, raw, pending.change.after.id)
          : raw
        : null;
      const loaded = await loadTextFile(pending.target.sessionId, pending.target.modRoot, pending.nextPath);
      if (disposed || sequence !== identitySequence || pending !== pendingIdentity || raw !== text.value) return;
      const target = { ...pending.target, filePath: pending.nextPath };
      await retargetTextEditorWindow(pending.target.sessionId!, pending.event.modRoot, target.filePath, title.value);
      if (disposed || sequence !== identitySequence || pending !== pendingIdentity || raw !== text.value) return;
      draftSession.adoptIdentity(
        pending.target,
        {
          target,
          value: readTextContent(loaded.text),
          baseVersions: loaded.baseVersions,
          meta: { entity: loaded.entity, receipt: null },
        },
        () => readTextContent(followed ?? loaded.text),
        pending.change ? 'external' : 'identity',
      );
      pendingIdentity = null;
      identityNotice.value = '';
    } catch (error) {
      if (disposed || sequence !== identitySequence || pending !== pendingIdentity) return;
      identityNotice.value = '实体已重命名，当前文本已保留；修正文本后接纳新身份。';
      contextMessage.value = formatError(error);
      contextSeverity.value = 'error';
      const position = errorDiagnosticOf(error).location;
      if (position?.line) {
        targetLine.value = position.line;
        targetColumn.value = position.column ?? undefined;
      }
      if (required) throw error;
    }
  }

  const undoEdit = document.undo;
  const redoEdit = document.redo;

  function handleCommittedWriteEvent(change: CommittedWriteEvent) {
    const target = draftSession.currentTarget.value;
    const update = sessionContentUpdate(change, target?.sessionId);
    if (!update) return undefined;
    if (!target || disposed || pendingIdentity || update.manifest.sessionId !== target.sessionId) return undefined;

    if (normalizeFsPath(update.manifest.modRoot) !== normalizeFsPath(target.modRoot)) return undefined;
    const renamed = update.invalidation.renames?.find(([before]) => pathBelongsToRoot(target.filePath, before));
    if (renamed)
      return [
        async () => {
          const [before, after] = renamed;
          const nextPath =
            normalizeFsPath(target.filePath) === normalizeFsPath(before)
              ? after
              : joinRootRelativePath(after, relativePathFromRoot(before, target.filePath));
          const preserve = draftSession.dirty.value;
          if (preserve) {
            const choice = await feedback.choose({
              title: '跟随文件改名？',
              content: `原文件：\n${target.filePath}\n\n新文件：\n${nextPath}\n\n跟随后保留当前文本。`,
              choices: [{ label: '保留文本并跟随', value: 'follow', type: 'primary' }],
              cancelText: '稍后处理',
            });
            if (disposed || textEditorTargetKey(target) !== draftSession.currentTargetKey.value) return;
            if (choice !== 'follow') throw new AppError('文件身份交接尚未确认', { code: 'write.identity_pending' });
          }
          pendingIdentity = { nextPath, event: change, target, preserve };
          await followPendingIdentity(true);
        },
      ];
    const receipt = change.reason === 'refresh' ? null : change.result;
    if (receipt && !draftSession.acceptsSaveDelivery(target, receipt.requestId)) return undefined;
    if (
      receipt?.identityChanges.some(
        (identity) =>
          normalizeFsPath(identity.after.write.path) === normalizeFsPath(target.filePath) &&
          (identity.before.id !== identity.after.id ||
            normalizeFsPath(identity.before.write.path) !== normalizeFsPath(identity.after.write.path)),
      )
    )
      return undefined;
    const entity = draftSession.baselineSnapshot.value?.meta.entity ?? null;
    const identity = receipt?.identityChanges.find((entry) => normalizeFsPath(entry.after.write.path) === normalizeFsPath(target.filePath));
    const content = receipt ? committedFileText(receipt, target.filePath) : undefined;
    if (
      content !== undefined &&
      (!entity || identity) &&
      receipt!.baseVersions.some((version) => normalizeFsPath(version.path) === normalizeFsPath(target.filePath))
    ) {
      draftSession.applyExternalForTarget(
        {
          target,
          value: readTextContent(content),
          baseVersions: receipt!.baseVersions,
          requestId: receipt!.requestId,
          meta: { entity: identity ? { target: identity.after, baseVersions: receipt!.baseVersions } : null, receipt: null },
        },
        true,
      );
      return undefined;
    }
    const affected = update.invalidation.paths.some((path) =>
      pathBelongsToRoot(target.filePath, isAbsoluteFsPath(path) ? path : joinRootRelativePath(target.modRoot, path)),
    );
    if (affected || update.invalidation.session) return draftSession.refreshTarget(target, true).then(() => {});
    return undefined;
  }

  function applyLocation(location: TextWindowLocation) {
    targetLine.value = normalizeEventLine(location.line);
    targetColumn.value = normalizeEventLine(location.column);
  }
  return {
    document,
    inputs: draftSession.inputs,
    contentReady: draftSession.ready,
    filePath: currentPath,
    title,
    contextLabel,
    contextSeverity,
    contextMessage,
    targetLine,
    targetColumn,
    text,
    loading: draftSession.loading,
    saving: draftSession.saving,
    waitForSave: draftSession.waitForSave,
    dirty,
    handoffLocked: computed(() => false),
    canSave: computed(
      () => !useProjectSyncStore().isWaiting(params.modRoot) && draftSession.ready.value && (dirty.value || draftSession.saving.value),
    ),
    hasPendingExternalText,
    externalTextNotice,
    lineCount,
    canUndo,
    canRedo,
    isErrorContext,
    isWarningContext,
    initialize,
    retry: () =>
      initialize().then(
        () => true,
        () => false,
      ),
    dispose,
    saveFile,
    cancelChanges,
    loadPendingExternalText,
    updateText,
    applyLocation,
    undoEdit,
    redoEdit,
  };

  function textEditorTarget(): TextEditorTarget | null {
    if (!currentPath.value) {
      feedback.error('缺少文件路径');
      return null;
    }
    if (!params.modRoot) {
      feedback.error('缺少文件读取根目录');
      return null;
    }
    if (params.mode === 'session' && !params.sessionId) {
      feedback.error('缺少文本编辑器 session');
      return null;
    }
    return { filePath: currentPath.value, mode: params.mode, modRoot: params.modRoot, sessionId: params.sessionId };
  }
}

function textEditorTargetKey(target: TextEditorTarget): string {
  return `${target.mode}\n${target.sessionId ?? ''}\n${normalizeFsPath(target.modRoot)}\n${normalizeFsPath(target.filePath)}`;
}

function normalizeEventLine(value: number | null): number | undefined {
  return value !== null && Number.isFinite(value) && value > 0 ? value : undefined;
}
