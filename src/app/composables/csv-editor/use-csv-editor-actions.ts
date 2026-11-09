import { computed, onScopeDispose, watch } from 'vue';

import type { AppFeedback, CsvTableTarget } from '@/shared/types';

import { openEntityImmersiveEditor } from '@/orchestrators/immersive-editor.orchestrator';
import { openSpecEditorWindow } from '@/windows/spec-editor.window';
import { openWeaponFirePreviewWindow } from '@/windows/weapon-fire-preview.window';
import { useProjectStore } from '@/stores/project.store';

import { useCsvEditorStore } from '@/stores/csv-editor.store';
import type { TableDetailAction } from '@/domain/csv-editor/table-detail-actions';
import { openFileEditorWindow, type FileEditorRequest } from '@/windows/file-editor.window';

import { querySessionEntityEditTarget } from '@/services/entity-query.service';
import { resolveWingReference } from '@/orchestrators/joint-edit.orchestrator';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { AppError } from '@/shared/lib/errors';

import type { CsvEditorModel } from './use-csv-editor-model';
import type { CsvEditorHost } from './csv-editor-context';

export function useCsvEditorActions(model: CsvEditorModel, host: CsvEditorHost, feedback: AppFeedback) {
  const project = useProjectStore();
  const tables = useCsvEditorStore();
  const view = model.view;
  const key = computed(() => JSON.stringify(model.target.value));
  let disposed = false;
  let contextRevision = 0;
  onScopeDispose(() => {
    disposed = true;
  });
  const active = () => !disposed && Boolean(model.state.value) && key.value === JSON.stringify(host.target.value);
  const matches = (target: CsvTableTarget) => active() && key.value === JSON.stringify(target);
  const reads = useQueryReadOwner();
  watch(
    () => [key.value, view.selectedRowKey],
    () => {
      contextRevision++;
      reads.revoke();
    },
    { flush: 'sync' },
  );
  async function save() {
    const context = { paths: model.state.value!.documents[view.currentTab].baseVersions.map((version) => version.path) };
    try {
      const result = await model.document.value!.save();
      if (result.status === 'noop') feedback.info('没有需要保存的修改', context);
      return result;
    } catch (error) {
      feedback.error(error, '保存 CSV 失败', context);
    }
    return undefined;
  }

  const undoCurrentTableEdit = () => replay('undo');
  const redoCurrentTableEdit = () => replay('redo');
  async function replay(direction: 'undo' | 'redo') {
    try {
      const result = await model.document.value?.[direction]();
      if (result === false) feedback.error(direction === 'undo' ? '撤销 CSV 编辑失败' : '重做 CSV 编辑失败');
    } catch (error) {
      feedback.error(error, direction === 'undo' ? '撤销 CSV 编辑失败' : '重做 CSV 编辑失败');
    }
  }

  async function addNewRow() {
    const target = model.target.value!,
      state = model.state.value;
    try {
      if ((await tables.getTableInputs(target.modRoot, target.table).commit()) === false || !matches(target) || model.state.value !== state)
        return;
      tables.addNewRow(target);
    } catch (error) {
      if (active()) feedback.error(error, '新建 CSV 行失败');
    }
  }
  async function deleteSelectedRow() {
    const target = model.target.value!,
      state = model.state.value,
      rowKey = view.selectedRowKey;
    if (!rowKey) return;
    try {
      const editing = view.editing;
      if (editing?.rowKey === rowKey) {
        tables.getTableInputs(target.modRoot, target.table).cancel();
        tables.setActiveCell(null, target.modRoot);
      } else if ((await tables.getTableInputs(target.modRoot, target.table).commit()) === false) return;
      if (!matches(target) || model.state.value !== state || view.selectedRowKey !== rowKey) return;
      tables.deleteSelectedRow(target);
    } catch (error) {
      if (active()) feedback.error(error, '删除 CSV 行失败');
    }
  }
  async function navigateToWingReference(action: Extract<TableDetailAction, { type: 'wing-navigation' }>) {
    const commands = useSaveCommandStore(),
      sequence = commands.beginTransition(),
      revision = contextRevision;
    const current = () =>
      contextRevision === revision &&
      commands.isTransitionCurrent(sequence) &&
      active() &&
      model.target.value?.sessionId === action.sessionId &&
      model.target.value.modRoot === action.modRoot &&
      view.currentTab === 'wings' &&
      view.selectedRowKey === action.rowKey;
    try {
      const waiting = commands.waitForSaves();
      if ((waiting && !(await waiting)) || !current()) return;
      const inputs = tables.getTableInputs(action.modRoot, 'wings'),
        admitted = inputs.captureContext();
      if ((await inputs.commit()) === false || !current() || !admitted()) return;
      const id = String(view.selectedRow!.variant ?? '').trim();
      await reads.consume(
        'wing-navigation',
        { action, id },
        (signal) =>
          resolveWingReference({ sessionId: action.sessionId, modRoot: action.modRoot, kind: 'variant', id }, action.destination, signal),
        {
          ready: (target) => {
            if (!current() || !admitted() || inputs.dirty.value || String(view.selectedRow!.variant ?? '').trim() !== id) return;
            const { kind } = target;
            const label = { ship: '船体', skin: '舰船皮肤', variant: '装配' }[kind];
            if (target.source === 'core') {
              feedback.info(label + '「' + target.id + '」来自原版。', {
                paths: [action.modRoot, ...(target.sourcePath ? [target.sourcePath] : [])],
              });
              return;
            }
            if (!target.source)
              throw new AppError('当前 Mod 没有' + label + '记录「' + target.id + '」', { action: 'navigate-wing-reference' });
            host.locateWingReference(action, { kind, id: target.id, ...(target.rowKey ? { rowKey: target.rowKey } : {}) });
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
      void navigateToWingReference(action);
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
    addNewRow,
    deleteSelectedRow,
    handleDetailAction,
    redoCurrentTableEdit,
    save,
    undoCurrentTableEdit,
  };
}
