import { h, ref, watch } from 'vue';

import type { AppFeedback } from '@/shared/types';

import { openEntityImmersiveEditor } from '@/orchestrators/immersive-editor.orchestrator';
import { openSpecEditorWindow } from '@/windows/spec-editor.window';
import { openWeaponFirePreviewWindow } from '@/windows/weapon-fire-preview.window';
import { useProjectStore } from '@/stores/project.store';

import { useCsvEditorStore } from '@/stores/csv-editor.store';
import type { AssociatedSpecCandidate } from '@/domain/csv-editor/associated-spec-candidates';
import type { TableDetailAction } from '@/domain/csv-editor/table-detail-actions';
import { openFileEditorWindow, type FileEditorRequest } from '@/windows/file-editor.window';

import { useWorkspaceStore } from '@/stores/workspace.store';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';
import { querySessionEntityEditTarget } from '@/services/entity-query.service';
import { resolveWingReference } from '@/orchestrators/joint-edit.orchestrator';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { navigateToModTable, navigateToModJson } from '@/orchestrators/workspace-navigation.orchestrator';
import { AppError } from '@/shared/lib/errors';

export function useCsvEditorActions(feedback: AppFeedback) {
  const project = useProjectStore();
  const tables = useCsvEditorStore();
  const workspace = useWorkspaceStore();
  const reads = useQueryReadOwner();
  watch(
    () => [workspace.activeSessionId, workspace.activeModRoot, tables.currentTab, tables.selectedRowKey],
    () => reads.revoke(),
    { flush: 'sync' },
  );
  async function save() {
    try {
      const result = await tables.activeEditor!.save();
      if (result.status === 'noop') feedback.info('没有需要保存的修改');
      return result;
    } catch (error) {
      feedback.error(error, '保存 CSV 失败');
    }
    return undefined;
  }

  async function selectAssociatedSpecs(candidates: AssociatedSpecCandidate[]) {
    const { default: AssociatedSpecSaveDialog } = await import('@/app/components/AssociatedSpecSaveDialog.vue');
    const choices = ref(candidates);
    const selectedKeys = ref(
      new Set(
        candidates
          .filter(
            (candidate) =>
              !candidate.preparation?.destination.version.fingerprint ||
              !candidate.preparation.destination.problem ||
              (candidate.preparation.original?.version.fingerprint && !candidate.preparation.original.problem),
          )
          .map((candidate) => candidate.key),
      ),
    );
    const choice = await feedback.choose({
      title: '保存 CSV',
      content: () =>
        h(AssociatedSpecSaveDialog, {
          candidates: choices.value,
          selectedKeys: selectedKeys.value,
          'onUpdate:candidates': (value) => {
            choices.value = value;
          },
          onSelect: (key, checked) => {
            if (checked) selectedKeys.value.add(key);
            else selectedKeys.value.delete(key);
          },
        }),
      choices: [{ label: '保存', value: 'save', type: 'primary' }],
    });
    if (choice !== 'save') return null;
    return choices.value
      .filter((candidate) => selectedKeys.value.has(candidate.key))
      .map((candidate) => ({
        change: candidate.change,
        target: candidate.preparation!.target,
        resolution:
          candidate.change.action === 'delete'
            ? null
            : {
                mode: candidate.mode!,
                original: candidate.preparation!.original,
                destination: candidate.preparation!.destination,
              },
      }));
  }

  const undoCurrentTableEdit = () => replay('undo');
  const redoCurrentTableEdit = () => replay('redo');
  async function replay(direction: 'undo' | 'redo') {
    try {
      const result = await tables.activeEditor?.[direction]();
      if (result === false) feedback.error(direction === 'undo' ? '撤销 CSV 编辑失败' : '重做 CSV 编辑失败');
    } catch (error) {
      feedback.error(error, direction === 'undo' ? '撤销 CSV 编辑失败' : '重做 CSV 编辑失败');
    }
  }

  async function addNewRow() {
    if (!workspace.activeManifest) return;
    const root = tables.activeModRoot;
    const table = tables.currentTab;
    try {
      if ((await commitCurrentInput()) === false || root !== tables.activeModRoot || table !== tables.currentTab) return;
      const created = tables.addNewRow();
      recordLogBestEffort({
        level: 'info',
        code: 'tables.row_created',
        message: 'row created',
        path: null,
        line: null,
        fields: logFields({
          modRoot: tables.activeModRoot,
          table: tables.currentTab,
          rowKey: created?.rowKey,
          rowIndex: created?.rowIndex,
        }),
      });
    } catch (err) {
      feedback.error(err, '新建 CSV 行失败');
    }
  }

  async function deleteSelectedRow() {
    if (!workspace.activeManifest || !tables.selectedRowKey) return;
    const root = tables.activeModRoot;
    const table = tables.currentTab;
    const rowKey = tables.selectedRowKey;
    try {
      const target = tables.editing;
      if (target?.rowKey === tables.selectedRowKey) {
        tables.getTableInputs(target.modRoot, target.table).cancel();
        tables.setActiveCell(null, target.modRoot);
      } else if ((await commitCurrentInput()) === false) return;
      if (root !== tables.activeModRoot || table !== tables.currentTab || rowKey !== tables.selectedRowKey) return;
      const deleted = tables.deleteSelected();
      recordLogBestEffort({
        level: 'info',
        code: 'tables.row_deleted',
        message: 'row deleted',
        path: null,
        line: null,
        fields: logFields({
          modRoot: tables.activeModRoot,
          table: tables.currentTab,
          rowKey: deleted?.rowKey,
          rowIndex: deleted?.rowIndex,
        }),
      });
    } catch (err) {
      feedback.error(err, '删除 CSV 行失败');
    }
  }

  function commitCurrentInput() {
    const root = tables.activeModRoot;
    return root ? tables.getTableInputs(root, tables.currentTab).commit() : undefined;
  }

  async function navigateWing(action: Extract<TableDetailAction, { type: 'wing-navigation' }>) {
    const commands = useSaveCommandStore(),
      sequence = commands.beginTransition();
    const current = () =>
      commands.isTransitionCurrent(sequence) &&
      workspace.activeSessionId === action.sessionId &&
      workspace.activeModRoot === action.modRoot &&
      tables.currentTab === 'wings' &&
      tables.selectedRowKey === action.rowKey;
    try {
      const waiting = commands.waitForSaves();
      if ((waiting && !(await waiting)) || !current()) return;
      const inputs = tables.getTableInputs(action.modRoot, 'wings'),
        admitted = inputs.captureContext();
      if ((await inputs.commit()) === false || !current() || !admitted()) return;
      const id = String(tables.selectedRow!.variant ?? '').trim();
      await reads.consume(
        'wing-navigation',
        { action, id },
        (signal) =>
          resolveWingReference({ sessionId: action.sessionId, modRoot: action.modRoot, kind: 'variant', id }, action.destination, signal),
        {
          ready: (target) => {
            if (!current() || !admitted() || inputs.dirty.value || String(tables.selectedRow!.variant ?? '').trim() !== id) return;
            const { kind } = target;
            const label = { ship: '船体', skin: '舰船皮肤', variant: '装配' }[kind];
            if (target.source === 'core') {
              feedback.info(label + '「' + target.id + '」来自原版。');
              return;
            }
            if (!target.source)
              throw new AppError('当前 Mod 没有' + label + '记录「' + target.id + '」', { action: 'navigate-wing-reference' });
            if (kind === 'ship') navigateToModTable(action.modRoot, 'ships');
            else navigateToModJson(action.modRoot, kind === 'skin' ? 'skins' : 'variants');
            workspace.entityLocation = {
              sessionId: action.sessionId,
              modRoot: action.modRoot,
              kind,
              id: target.id,
              ...(target.rowKey ? { rowKey: target.rowKey } : {}),
            };
          },
          error: (error) => {
            if (current()) feedback.error(error, '跳转联队引用失败');
          },
        },
      );
    } catch (error) {
      if (current()) feedback.error(error, '跳转联队引用失败');
    }
  }
  function handleDetailAction(action: TableDetailAction) {
    if (action.type === 'wing-navigation') {
      void navigateWing(action);
    } else if (action.type === 'immersive-editor') {
      const csvTarget = project.tableWriteTargets.find(
        (target) =>
          target.sessionId === action.sessionId &&
          target.modRoot === action.modRoot &&
          target.table === (action.kind === 'ship' ? 'ships' : action.kind === 'weapon' ? 'weapons' : 'wings'),
      )!;
      void openEntityImmersiveEditor(
        {
          root: { sessionId: action.sessionId, modRoot: action.modRoot, kind: action.kind, id: action.id },
          rowKey: action.rowKey,
          csvTarget,
        },
        feedback,
      ).catch((error) => feedback.error(error, '打开沉浸式编辑器失败'));
    } else if (action.type === 'weapon-fire-preview') {
      void openWeaponFirePreviewWindow({
        sessionId: action.sessionId,
        modRoot: action.modRoot,
        id: action.id,
        source: { kind: 'saved' },
      }).catch((error) => feedback.error(error, '打开开火预览失败'));
    } else if (action.type === 'file-editor') {
      void querySessionEntityEditTarget(action.sessionId, action.kind, action.id)
        .then((info) =>
          openRequestedFileEditor({
            modRoot: action.modRoot,
            sessionId: action.sessionId,
            title: action.title,
            path: info.target.write.path,
          }),
        )
        .catch((error) => feedback.error(error, '读取规格文件目标失败'));
    } else {
      openRequestedEditorWindow(action);
    }
  }

  function openRequestedFileEditor(request: FileEditorRequest) {
    openFileEditorWindow({ ...request }).catch((error) => feedback.error(error, '打开文件编辑器失败'));
  }

  function openRequestedEditorWindow(action: Extract<TableDetailAction, { type: 'editor-window' }>) {
    openSpecEditorWindow({
      kind: action.kind,
      modRoot: action.modRoot,
      id: action.id,
      sessionId: action.sessionId,

      starsectorRoot: action.starsectorRoot,
    }).catch((error) => feedback.error(error, '打开编辑器窗口失败'));
  }

  return {
    selectAssociatedSpecs,
    addNewRow,
    deleteSelectedRow,
    handleDetailAction,
    redoCurrentTableEdit,
    save,
    undoCurrentTableEdit,
  };
}
