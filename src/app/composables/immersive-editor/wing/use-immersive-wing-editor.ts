import { ref } from 'vue';
import { dialogBody, dialogFiles, dialogSelect } from '@/shared/ui/dialog-content';
import type { JointEditRoot, JointEditSnapshot, JointValue } from '@/shared/types';
import type { ImmersiveEditorRuntime } from '../use-immersive-editor-runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryJointEditRow } from '@/services/joint-edit.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { immersiveEditableRecords } from '@/domain/immersive/source-records';
import { jointObject, rebaseJointDraft } from '@/domain/joint-edit';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { openImmersiveEditorWindow } from '@/windows/immersive-editor.window';
import { retargetImmersiveWindow } from '@/orchestrators/immersive-editor.orchestrator';
import { createShipSpec } from '@/domain/entity-write/spec-construction';
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
          return undefined;
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
        title: '跟随战机联队改名？',
        content: `战机联队 ID 已由 ${target.id} 改为 ${next.root.id}。\n\n${row.target.write.path}\n\n使用的装配：${jointObject(next.records.find((record) => record.key === next.bindings.csv)!.value).variant}。\n\n跟随后保留当前草稿、输入和草稿历史。`,
        choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
        cancelText: '稍后处理',
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
    const sourceTarget = record.target.target;
    let target = joint.currentTarget.value!;
    let baseline = snapshot.value;
    const current = () => runtime.isActive() && joint.isTargetCurrent(target) && snapshot.value === baseline;
    if (record.target.target.kind === 'variant') return runtime.toggleStat('hull-reference', true);
    if (record.target.target.kind === 'skin') return runtime.toggleStat('skin-base-reference', true);
    try {
      const method = ref('ship');
      const choice = await feedback.choose({
        title: '补全战机船体',
        content: () =>
          dialogBody(
            '战机联队 ' + target.id + ' 引用的船体 ' + sourceTarget.id + ' 缺少来源。',
            dialogFiles([sourceTarget.write.path]),
            dialogSelect('创建方式', method, [
              { label: '战机船体', value: 'ship' },
              { label: '舰船皮肤', value: 'skin' },
            ]),
            method.value === 'ship' ? '使用默认战机船体内容创建并保存。' : '选择基础船体，再编辑皮肤内容。',
            ...(joint.dirty.value
              ? [
                  method.value === 'ship' ? '同时保存以下文件中的当前修改：' : '先保存以下修改，再选择基础船体：',
                  dialogFiles(snapshot.value!.baseVersions.map((version) => version.path)),
                ]
              : []),
          ),
        choices: [
          {
            get label() {
              return method.value === 'ship' ? '创建并保存' : joint.dirty.value ? '保存并继续' : '继续创建皮肤';
            },
            value: 'continue',
            type: 'primary',
          },
        ],
        cancelText: '返回编辑',
      });
      if (!current() || choice === null) return;
      if (!(await joint.waitForSave()) || (await joint.inputs.commit()) === false || !current()) return;
      if (method.value === 'ship') {
        const before = deepClone(joint.draftValue.value);
        const after = {
          ...before,
          [key]: { state: 'present' as const, value: { ...createShipSpec(sourceTarget.id), hullSize: 'FIGHTER' } },
        };
        joint.setDraft(after);
        history.push(before, after);
        await runtime.save();
        return;
      }
      if (joint.dirty.value) {
        const saved = await joint.saveDraft();
        if (!saved || joint.dirty.value) return;
        target = saved.target;
        baseline = snapshot.value;
      }
      if (!current()) return;
      const row = snapshot.value!.records.find((entry) => entry.key === snapshot.value!.bindings.csv)!;
      if (row.target.kind !== 'csv') return;
      const rowKey = row.target.rowKey;
      const newSources = [...snapshot.value!.newSources, { kind: 'skin' as const, id: sourceTarget.id }];
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
  async function openRelatedEditor(kind: 'ship' | 'variant') {
    const target = joint.currentTarget.value!;
    const admitted = joint.inputs.captureContext();
    try {
      if (!(await joint.waitForSave()) || (await joint.inputs.commit()) === false) return;
      if (!runtime.isActive() || !admitted() || !joint.isTargetCurrent(target)) return;
      const current = snapshot.value!;
      if (kind === 'ship') {
        const hull = current.records.find((record) => record.key === current.bindings.hull)!;
        if (hull.target.kind !== 'spec') return;
        await openImmersiveEditorWindow({
          ...current.root,
          kind: hull.target.target.kind === 'skin' ? 'skin' : 'ship',
          id: hull.target.target.id,
        });
      } else {
        const id = schemaStringValue(jointObject(joint.draftValue.value[current.bindings.csv!]).variant);
        await openImmersiveEditorWindow({ ...current.root, kind, id });
      }
    } catch (error) {
      feedback.error(error, kind === 'ship' ? '打开舰船沉浸式编辑器失败' : '打开装配沉浸式编辑器失败');
    }
  }
  return { readSnapshot, refreshWingBaseline, createMissingSource, openRelatedEditor };
}
