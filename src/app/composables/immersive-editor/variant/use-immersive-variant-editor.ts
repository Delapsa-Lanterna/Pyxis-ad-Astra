import { ref, watch } from 'vue';
import type { RowData } from '@/shared/types';
import type { ImmersiveEditorRuntime } from '../use-immersive-editor-runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { AppError } from '@/shared/lib/errors';
import { isRowData } from '@/shared/lib/row-data';
import { jointObject } from '@/domain/joint-edit';
import {
  variantBranchKeys,
  stripVariant,
  equipVariantWeapon,
  weaponSlotCompatibility,
  isSystemWeapon,
} from '@/domain/immersive/variant/variant-actions';
import { queryJointVariantCatalog } from '@/services/joint-edit.service';

export function useImmersiveVariantEditor(runtime: ImmersiveEditorRuntime) {
  const { joint, snapshot, displaySnapshot, history, reads, createOverrides, dismissStat } = runtime;
  const feedback = useAppFeedback();
  const variantActionPending = ref(false);
  async function commitVariantInputs(): Promise<boolean> {
    const target = joint.currentTarget.value,
      admitted = joint.inputs.captureContext();
    try {
      return (await joint.inputs.commit()) !== false && runtime.isActive() && admitted() && joint.currentTarget.value === target;
    } catch (error) {
      feedback.error(error, '提交装配输入失败');
      return false;
    }
  }

  async function updateVariant(key: string, transform: (data: Readonly<RowData>) => RowData): Promise<boolean> {
    return updateVariants([{ key, transform }]);
  }

  async function updateVariants(changes: readonly { key: string; transform: (data: Readonly<RowData>) => RowData }[]): Promise<boolean> {
    const target = joint.currentTarget.value;
    const admitted = joint.inputs.captureContext();
    try {
      if (!(await commitVariantInputs()) || !runtime.isActive() || !admitted() || joint.currentTarget.value !== target) return false;
      const core = changes.filter(
        (change) => snapshot.value!.records.find((record) => record.key === change.key)!.source?.source === 'core',
      );
      if (core.length) {
        await createOverrides(core.map((change) => change.key));
        return false;
      }
      applyVariantActions(changes);
      return true;
    } catch (error) {
      feedback.error(error, '提交装配动作失败');
      return false;
    }
  }

  function applyVariantAction(key: string, transform: (data: Readonly<RowData>) => RowData) {
    applyVariantActions([{ key, transform }]);
  }

  function applyVariantActions(changes: readonly { key: string; transform: (data: Readonly<RowData>) => RowData }[]) {
    const before = deepClone(joint.draftValue.value);
    const after = { ...before };
    for (const { key, transform } of changes) after[key] = { state: 'present', value: transform(jointObject(before[key])) };
    joint.setDraft(after);
    history.push(before, after);
  }

  function cancelVariantAction() {
    reads.revoke('consumer', 'variant-action');
    variantActionPending.value = false;
  }

  async function installVariantWeapon(key: string, slotId: string, id: string, inputCommitted = false): Promise<boolean> {
    if (variantActionPending.value) return false;
    const target = joint.currentTarget.value!;
    variantActionPending.value = true;
    let applied = false;
    await reads.consume(
      'variant-action',
      { target, key, slotId, id },
      async (signal) => {
        if (
          (!inputCommitted && (!(await joint.waitForSave()) || !(await commitVariantInputs()))) ||
          signal.aborted ||
          !runtime.isActive() ||
          joint.currentTarget.value !== target
        )
          return null;
        const captured = snapshot.value!,
          graph = displaySnapshot.value!;
        const record = captured.records.find((record) => record.key === key)!;
        if (record.source?.source === 'core') {
          if (inputCommitted && joint.saving.value) return null;
          await createOverrides([key]);
          return null;
        }
        const slot = graph.variants[key]!.slots.filter(isRowData).find((slot) => slot.id === slotId)!;
        const before = deepClone(joint.draftValue.value),
          admitted = joint.inputs.captureContext();
        const current = () =>
          !signal.aborted &&
          runtime.isActive() &&
          admitted() &&
          joint.currentTarget.value === target &&
          snapshot.value === captured &&
          !joint.inputs.dirty.value &&
          stableDeepEqual(before, joint.draftValue.value);
        if (id) {
          const catalog = await queryJointVariantCatalog(target, 'weapons', signal);
          if (!current()) return null;
          const entry = catalog.catalog.entries.find((entry) => entry.id === id);
          const spec = entry && isRowData(entry.spec) ? entry.spec : null;
          const reason = !entry
            ? '武器目录来源缺失'
            : !spec
              ? '武器规格来源缺失'
              : isSystemWeapon(isRowData(entry.data) ? entry.data : {}, spec)
                ? '武器带有SYSTEM标记'
                : weaponSlotCompatibility(slot, spec);
          if (reason) {
            const choice = await feedback.choose({
              title: '强制安装武器？',
              content: `装配：${jointObject(before[key]).variantId}\n槽位：${slotId} · ${slot.type} · ${slot.size}\n武器：${id}\n${reason}\n来源：${entry?.specSource?.path ?? entry?.source.path ?? '来源缺失'}`,
              choices: [{ label: '强制安装', value: 'install', type: 'warning' }],
            });
            if (choice !== 'install' || !current()) return null;
            const latest = await queryJointVariantCatalog(target, 'weapons', signal);
            if (
              !current() ||
              !stableDeepEqual(
                entry,
                latest.catalog.entries.find((entry) => entry.id === id),
              )
            )
              return null;
          }
        }
        return current() ? [{ key, transform: (data: Readonly<RowData>) => equipVariantWeapon(data, slotId, id) }] : null;
      },
      {
        ready: (changes) => {
          if (changes) {
            applyVariantActions(changes);
            applied = true;
          }
        },
        error: (error) => feedback.error(error, '安装武器失败'),
        settled: () => {
          variantActionPending.value = false;
        },
      },
    );
    return applied;
  }

  async function stripVariantBranch(key: string): Promise<boolean> {
    if (variantActionPending.value) return false;
    const target = joint.currentTargetKey.value;
    variantActionPending.value = true;
    let applied = false;
    await reads.consume(
      'variant-action',
      { target, key },
      async (signal) => {
        if (
          !(await joint.waitForSave()) ||
          !(await commitVariantInputs()) ||
          signal.aborted ||
          !runtime.isActive() ||
          joint.currentTargetKey.value !== target
        )
          return null;
        let graph = displaySnapshot.value!;
        let keys = variantBranchKeys(graph, joint.draftValue.value, key);
        const core = keys.filter((key) => graph.records.find((record) => record.key === key)!.source?.source === 'core');
        if (core.length) {
          if (!(await joint.createOverrides(core)) || signal.aborted || !runtime.isActive() || joint.currentTargetKey.value !== target)
            return null;
          graph = snapshot.value!;
          keys = variantBranchKeys(graph, joint.draftValue.value, key);
        }
        const before = deepClone(joint.draftValue.value),
          admitted = joint.inputs.captureContext(),
          captured = snapshot.value;
        const missing = keys.find((key) => !graph.variants[key]);
        if (missing) throw new AppError('装配缺少有效舰体来源：' + missing, { action: 'strip-variant' });
        const details = keys
          .map((key) => {
            const record = graph.records.find((record) => record.key === key)!;
            const location = record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path;
            return (
              String(jointObject(before[key]).variantId) + '\n' + location + '\n共享引用：' + (record.referencedBy.join('、') || '当前装配')
            );
          })
          .join('\n\n');
        const choice = await feedback.choose({
          title: '清空装配？',
          content:
            '清空以下 ' +
            keys.length +
            ' 个装配的可编辑武器、联队、普通／永久／S插件及幅能分配。确认后登记一次草稿历史，保存后写盘。\n\n' +
            details,
          choices: [{ label: '清空草稿', value: 'strip', type: 'warning' }],
        });
        if (
          signal.aborted ||
          choice !== 'strip' ||
          !runtime.isActive() ||
          !admitted() ||
          joint.currentTargetKey.value !== target ||
          snapshot.value !== captured ||
          !stableDeepEqual(before, joint.draftValue.value) ||
          joint.inputs.dirty.value
        )
          return null;
        return keys.map((key) => ({ key, transform: (data: Readonly<RowData>) => stripVariant(data, graph.variants[key]!) }));
      },
      {
        ready: (changes) => {
          if (changes) {
            applyVariantActions(changes);
            dismissStat();
            applied = true;
          }
        },
        error: (error) => feedback.error(error, '清空装配失败'),
        settled: () => {
          variantActionPending.value = false;
        },
      },
    );
    return applied;
  }
  watch(joint.currentTargetKey, cancelVariantAction);
  return {
    ...runtime,
    variantActionPending,
    commitVariantInputs,
    updateVariant,
    updateVariants,
    applyVariantAction,
    applyVariantActions,
    cancelVariantAction,
    installVariantWeapon,
    stripVariantBranch,
  };
}
