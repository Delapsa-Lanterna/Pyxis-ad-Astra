import type {
  JointEditRoot,
  JointEditSnapshot,
  JointEditDraft,
  JointConflictChoice,
  JointEditWriteResult,
  AppFeedback,
  EditWriteTarget,
} from '@/shared/types';
import { queryJointEdit, queryJointEditRow, prepareJointEdit, saveJointEdit } from '@/services/joint-edit.service';
import { withEditTargetHandoff } from '@/orchestrators/edit-target-handoff.orchestrator';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { jointWriteTargets, applyJointConflictChoices } from '@/domain/joint-edit';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { AppError } from '@/shared/lib/errors';

export async function resolveWingReference(root: JointEditRoot, destination: 'hull' | 'variant', signal?: AbortSignal) {
  const snapshot = await queryJointEdit(root, signal);
  const key = destination === 'variant' ? snapshot.bindings.variant : snapshot.bindings.hull;
  const record = snapshot.records.find((entry) => entry.key === key);
  if (!record || record.value.state !== 'present' || record.target.kind !== 'spec')
    throw new AppError('找不到联队引用的' + (destination === 'variant' ? '装配' : '船体'), { action: 'navigate-wing-reference' });
  const target = record.target.target;
  const kind: 'ship' | 'skin' | 'variant' = target.kind === 'skin' ? 'skin' : target.kind === 'variant' ? 'variant' : 'ship';
  const source = kind === 'ship' ? snapshot.records.find((entry) => entry.key === snapshot.hull!.displayBindings.csv)! : record;
  return {
    kind,
    id: target.id,
    source: source.source?.source ?? null,
    rowKey: source.target.kind === 'csv' ? source.target.rowKey : undefined,
  };
}

export async function openJointEditSnapshot(
  root: JointEditRoot,
  feedback: AppFeedback,
  signal?: AbortSignal,
  editableRecords?: (snapshot: JointEditSnapshot) => string[],
): Promise<JointEditSnapshot | null> {
  const captured = cloneQuerySnapshot<JointEditSnapshot>(await queryJointEdit(root, signal));
  return withEditTargetHandoff(
    jointWriteTargets(captured, editableRecords?.(captured)),
    feedback,
    async (receipts) => {
      if (root.kind === 'wing') {
        const row = captured.records.find((record) => record.key === captured.bindings.csv)!;
        if (row.target.kind === 'csv') {
          const key = row.target.rowKey;
          const mapped = receipts.flatMap((receipt) => receipt.keyMap).findLast((mapping) => mapping.previousKey === key)?.nextKey ?? key;
          return cloneQuerySnapshot<JointEditSnapshot>(await queryJointEditRow(root, mapped, signal));
        }
      }
      const identity = receipts
        .flatMap((receipt) => receipt.identityChanges)
        .findLast((change) => change.before.kind === root.kind && change.before.id === root.id);
      return cloneQuerySnapshot<JointEditSnapshot>(await queryJointEdit({ ...root, id: identity?.after.id ?? root.id }, signal));
    },
    undefined,
    undefined,
    signal,
  );
}

export function openJointEditRowSnapshot(
  root: Omit<JointEditRoot, 'id'>,
  rowKey: string,
  target: EditWriteTarget,
  feedback: AppFeedback,
): Promise<JointEditSnapshot | null> {
  return withEditTargetHandoff([target], feedback, async (receipts) => {
    const mapped = receipts.flatMap((receipt) => receipt.keyMap).findLast((mapping) => mapping.previousKey === rowKey)?.nextKey ?? rowKey;
    return cloneQuerySnapshot<JointEditSnapshot>(await queryJointEditRow(root, mapped));
  });
}

export async function submitJointEdit(
  draft: JointEditDraft,
  feedback: AppFeedback,
  chooseConflicts: (prepared: import('@/shared/types').JointEditPrepared) => Promise<JointConflictChoice[] | null>,
  excludeTargetKey?: string,
  deferRelease?: (release: () => Promise<void>) => void,
  createOverrides: string[] = [],
): Promise<JointEditWriteResult | null> {
  return withEditTargetHandoff(
    jointWriteTargets(draft.baseline, Object.keys(draft.values)),
    feedback,
    async () => {
      const prepared = cloneQuerySnapshot<import('@/shared/types').JointEditPrepared>(await prepareJointEdit(draft));
      const choices = prepared.conflicts.length > 0 ? await chooseConflicts(prepared) : [];
      if (choices === null) return null;
      const values = applyJointConflictChoices(prepared, choices);
      const overrides = prepared.snapshot.records.filter(
        (record) =>
          Object.hasOwn(values, record.key) &&
          record.source?.source === 'core' &&
          (createOverrides.includes(record.key) || JSON.stringify(values[record.key]) !== JSON.stringify(record.value)),
      );
      const shared = prepared.snapshot.records.filter(
        (record) =>
          Object.hasOwn(values, record.key) &&
          record.referencedBy.length > 1 &&
          JSON.stringify(values[record.key]) !== JSON.stringify(record.value),
      );
      if (overrides.length + shared.length > 0) {
        const confirmed = await feedback.choose({
          title: '确认共享目标与 Mod 覆盖',
          content: [...new Set([...overrides, ...shared])]
            .map(
              (record) =>
                `${record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path}\n来源：${record.source?.path ?? '新建记录'}\n关联：${record.referencedBy.join('、')}`,
            )
            .join('\n'),
          choices: [{ label: '保存到上述目标', value: 'save', type: 'warning' }],
        });
        if (confirmed !== 'save') return null;
      }
      const result = await runConfirmedJsonWrite(feedback, (jsonWrite) =>
        saveJointEdit({
          snapshot: prepared.snapshot,
          values,
          baseVersions: prepared.snapshot.baseVersions,
          jsonWrite,
          createOverrides,
        }),
      );
      if (!result) return null;
      return result;
    },
    excludeTargetKey,
    deferRelease,
  );
}
