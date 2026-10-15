import type { JointEditRoot, JointEditSnapshot, JointValue } from '@/shared/types';
import type { ImmersiveEditorRuntime } from '../use-immersive-editor-runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryJointEditRow } from '@/services/joint-edit.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { immersiveEditableRecords } from '@/domain/immersive/source-records';
import { rebaseJointDraft } from '@/domain/joint-edit';
import { retargetImmersiveWindow } from '@/orchestrators/immersive-editor.orchestrator';

export function useImmersiveWingEditor(runtime: ImmersiveEditorRuntime) {
  const { root, joint, snapshot, referenceChanging, reads, history } = runtime;
  const feedback = useAppFeedback();
  function readSnapshot(target: JointEditRoot, signal?: AbortSignal) {
    const current = snapshot.value?.records.find((record) => record.key === snapshot.value!.bindings.csv);
    const rowKey = current?.target.kind === 'csv' ? current.target.rowKey : root.rowKey!;
    return queryJointEditRow(target, rowKey, signal, snapshot.value?.newSources ?? []);
  }
  async function refreshWingBaseline(target: JointEditRoot) {
    if (referenceChanging.value || !runtime.isActive() || !joint.isTargetCurrent(target)) return;
    if (joint.saving.value) {
      void joint
        .waitForSave()
        .then((saved) => {
          if (saved && runtime.isActive() && joint.currentTarget.value) return refreshWingBaseline(joint.currentTarget.value);
        })
        .catch((error) => feedback.error(error, '等待联队保存失败'));
      return;
    }
    const previous = snapshot.value;
    if (!previous) return;
    const row = previous.records.find((record) => record.key === previous.bindings.csv)!;
    if (row.target.kind !== 'csv') return;
    const rowKey = row.target.rowKey;
    let captured: JointEditSnapshot | null = null;
    await reads.consume('identity', { target, rowKey }, (signal) => queryJointEditRow(target, rowKey, signal), {
      ready: (value) => {
        captured = cloneQuerySnapshot<JointEditSnapshot>(value);
      },
      error: (error) => feedback.error(error, '重读联队来源失败'),
    });
    if (!captured || !runtime.isActive() || !joint.isTargetCurrent(target)) return;
    const next: JointEditSnapshot = captured;
    const values = Object.fromEntries(
      next.records.filter((record) => immersiveEditableRecords(next).includes(record.key)).map((record) => [record.key, record.value]),
    );
    const actual = {
      target: next.root,
      value: values,
      baseVersions: next.baseVersions,
      meta: { snapshot: next, receipt: null, previous: null },
    };
    if (next.root.id === target.id) {
      joint.applyExternalForTarget(actual);
      return;
    }
    if (joint.dirty.value) {
      const choice = await feedback.choose({
        title: '跟随联队重命名？',
        content: '保留当前草稿、活动输入和历史，并接纳新的联队身份。',
        choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
      });
      if (choice !== 'follow' || !runtime.isActive() || !joint.isTargetCurrent(target)) return;
    }
    await retargetImmersiveWindow(next);
    const map = (draft: Record<string, JointValue>) => rebaseJointDraft(draft, previous, next, [], []);
    if (joint.adoptIdentity(target, actual, map, 'identity')) history.rebase(map);
  }
  return { readSnapshot, refreshWingBaseline };
}
