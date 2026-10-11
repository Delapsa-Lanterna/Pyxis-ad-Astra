import type {
  JointEditRoot,
  JointEditSnapshot,
  JointEditDraft,
  JointConflictChoice,
  JointEditWriteResult,
  AppFeedback,
} from '@/shared/types';
import { queryJointEdit, prepareJointEdit, saveJointEdit } from '@/services/joint-edit.service';
import { withEditTargetHandoff } from '@/orchestrators/edit-target-handoff.orchestrator';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { jointWriteTargets, applyJointConflictChoices } from '@/domain/joint-edit';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';

export async function openJointEditSnapshot(
  root: JointEditRoot,
  feedback: AppFeedback,
  signal?: AbortSignal,
): Promise<JointEditSnapshot | null> {
  const captured = cloneQuerySnapshot<JointEditSnapshot>(await queryJointEdit(root, signal));
  return withEditTargetHandoff(
    jointWriteTargets(captured),
    feedback,
    async (receipts) => {
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

export async function submitJointEdit(
  draft: JointEditDraft,
  feedback: AppFeedback,
  chooseConflicts: (prepared: import('@/shared/types').JointEditPrepared) => Promise<JointConflictChoice[] | null>,
  excludeTargetKey?: string,
  deferRelease?: (release: () => Promise<void>) => void,
): Promise<JointEditWriteResult | null> {
  return withEditTargetHandoff(
    jointWriteTargets(draft.baseline),
    feedback,
    async () => {
      const prepared = cloneQuerySnapshot<import('@/shared/types').JointEditPrepared>(await prepareJointEdit(draft));
      const choices = prepared.conflicts.length > 0 ? await chooseConflicts(prepared) : [];
      if (choices === null) return null;
      const values = applyJointConflictChoices(prepared, choices);
      const overrides = prepared.snapshot.records.filter(
        (record) => record.source?.source === 'core' && JSON.stringify(values[record.key]) !== JSON.stringify(record.value),
      );
      const shared = prepared.snapshot.records.filter(
        (record) => record.referencedBy.length > 1 && JSON.stringify(values[record.key]) !== JSON.stringify(record.value),
      );
      if (overrides.length + shared.length > 0) {
        const confirmed = await feedback.choose({
          title: '确认共享目标与 Mod 覆盖',
          content: [...new Set([...overrides, ...shared])]
            .map((record) => (record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path))
            .join('\n'),
          choices: [{ label: '保存到上述目标', value: 'save', type: 'warning' }],
        });
        if (confirmed !== 'save') return null;
      }
      const result = await runConfirmedJsonWrite(feedback, (jsonWrite) =>
        saveJointEdit({ snapshot: prepared.snapshot, values, baseVersions: prepared.snapshot.baseVersions, jsonWrite }),
      );
      if (!result) return null;
      return result;
    },
    excludeTargetKey,
    deferRelease,
  );
}
