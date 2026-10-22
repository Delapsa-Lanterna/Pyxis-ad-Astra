import type { JointEditRoot, JointEditSnapshot, JointValue } from '@/shared/types';
import type { ImmersiveEditorRuntime } from '../use-immersive-editor-runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryJointEditRow } from '@/services/joint-edit.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { immersiveEditableRecords } from '@/domain/immersive/source-records';
import { rebaseJointDraft } from '@/domain/joint-edit';
import { retargetImmersiveWindow } from '@/orchestrators/immersive-editor.orchestrator';
import { createShipSpec } from '@/domain/editors/spec-construction';
import { deepClone } from '@/shared/lib/starsector';

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
        .catch((error) => feedback.error(error, '等待战机联队保存失败'));
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
      error: (error) => feedback.error(error, '刷新战机联队数据失败'),
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
        title: '跟随战机联队重命名？',
        content: '保留当前草稿、活动输入和历史，并接纳新的战机联队身份。',
        choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
      });
      if (choice !== 'follow' || !runtime.isActive() || !joint.isTargetCurrent(target)) return;
    }
    await retargetImmersiveWindow(next);
    const map = (draft: Record<string, JointValue>) => rebaseJointDraft(draft, previous, next, [], []);
    if (joint.adoptIdentity(target, actual, map, 'identity')) history.rebase(map);
  }
  async function createMissingSource(key: string) {
    const record = snapshot.value!.records.find((record) => record.key === key)!;
    if (record.target.kind !== 'spec') return;
    let target = joint.currentTarget.value!;
    let baseline = snapshot.value;
    const current = () => runtime.isActive() && joint.isTargetCurrent(target) && snapshot.value === baseline;
    if (record.target.target.kind === 'variant') return runtime.toggleStat('hull-reference', true);
    if (record.target.target.kind === 'skin') return runtime.toggleStat('skin-base-reference', true);
    try {
      const choice = await feedback.choose({
        title: '补全船体来源',
        content: `引用 ID：${record.target.target.id}。选择创建战机船体或 Skin；Skin 需要选择基础船体。`,
        choices: [
          { label: '创建战机船体', value: 'ship', type: 'primary' },
          { label: '创建 Skin', value: 'skin' },
        ],
      });
      if (!current() || (choice !== 'ship' && choice !== 'skin')) return;
      if (!(await joint.waitForSave()) || (await joint.inputs.commit()) === false || !current()) return;
      if (choice === 'ship') {
        const before = deepClone(joint.draftValue.value);
        const after = {
          ...before,
          [key]: { state: 'present' as const, value: { ...createShipSpec(record.target.target.id), hullSize: 'FIGHTER' } },
        };
        joint.setDraft(after);
        history.push(before, after);
        await runtime.save();
        return;
      }
      if (joint.dirty.value) {
        const accepted = await feedback.choose({
          title: '保存后补全来源？',
          content: '保存当前相关编辑，再建立 Skin 来源。',
          choices: [{ label: '保存并继续', value: 'save', type: 'primary' }],
        });
        if (accepted !== 'save' || !current()) return;
        const saved = await joint.saveDraft();
        if (!saved || joint.dirty.value) return;
        target = saved.target;
        baseline = snapshot.value;
      }
      if (!current()) return;
      const row = snapshot.value!.records.find((entry) => entry.key === snapshot.value!.bindings.csv)!;
      if (row.target.kind !== 'csv') return;
      const rowKey = row.target.rowKey;
      const newSources = [...snapshot.value!.newSources, { kind: 'skin' as const, id: record.target.target.id }];
      referenceChanging.value = true;
      let captured: JointEditSnapshot | null = null;
      await reads.consume('creation', { target, newSources }, (signal) => queryJointEditRow(target, rowKey, signal, newSources), {
        ready: (value) => {
          captured = cloneQuerySnapshot<JointEditSnapshot>(value);
        },
      });
      if (!captured || !current()) return;
      const next: JointEditSnapshot = captured;
      joint.applyExternalForTarget({
        target: next.root,
        value: Object.fromEntries(
          next.records.filter((entry) => immersiveEditableRecords(next).includes(entry.key)).map((entry) => [entry.key, entry.value]),
        ),
        baseVersions: next.baseVersions,
        meta: { snapshot: next, receipt: null, previous: null },
      });
      await runtime.toggleStat('skin-base-reference', true);
    } catch (error) {
      feedback.error(error, '补全船体失败');
    } finally {
      referenceChanging.value = false;
    }
  }
  return { readSnapshot, refreshWingBaseline, createMissingSource };
}
