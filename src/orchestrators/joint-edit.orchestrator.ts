import type {
  JointEditRoot,
  JointEditSnapshot,
  JointEditDraft,
  JointConflictChoice,
  JointEditWriteResult,
  AppFeedback,
  EditWriteTarget,
  JointEditPrepared,
  RowData,
} from '@/shared/types';
import { queryJointEdit, queryJointEditRow, prepareJointEdit, saveJointEdit } from '@/services/joint-edit.service';
import { confirmEntityIdChanges } from '@/orchestrators/entity-write.orchestrator';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { applyJointConflictChoices, takeJointReplaceBase } from '@/domain/joint-edit';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { infoLog } from '@/shared/runtime/app-log-queue';
import { logIdentity } from '@/shared/lib/log-fields';
import { AppError } from '@/shared/lib/errors';
import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';

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
  void feedback;
  void editableRecords;
  return cloneQuerySnapshot<JointEditSnapshot>(await queryJointEdit(root, signal));
}

export function openJointEditRowSnapshot(
  root: Omit<JointEditRoot, 'id'>,
  rowKey: string,
  target: EditWriteTarget,
  feedback: AppFeedback,
): Promise<JointEditSnapshot | null> {
  void target;
  void feedback;
  return queryJointEditRow(root, rowKey).then((snapshot) => cloneQuerySnapshot<JointEditSnapshot>(snapshot));
}

export async function submitJointEdit(
  draft: JointEditDraft,
  feedback: AppFeedback,
  chooseConflicts: (prepared: JointEditPrepared) => Promise<JointConflictChoice[] | null>,
  createOverrides: string[] = [],
  request?: SaveCommandRequest,
): Promise<JointEditWriteResult | null> {
  request ??= { id: crypto.randomUUID() };
  const context = { ...draft.baseline.root, requestId: request.id };
  const replaced = takeJointReplaceBase(draft.baseline, draft.values);
  draft = { ...draft, values: replaced.values };
  const prepared = cloneQuerySnapshot<JointEditPrepared>(await prepareJointEdit(draft));
  const choices = prepared.conflicts.length > 0 ? await chooseConflicts(prepared) : [];
  if (prepared.conflicts.length)
    infoLog('joint.conflicts_decided', () => ({
      ...context,
      status: choices === null ? 'cancelled' : 'confirmed',
      conflicts: JSON.stringify(
        prepared.conflicts.map(({ recordKey, path }) => ({
          recordKey,
          path,
          target: logIdentity(prepared.snapshot.records.find((record) => record.key === recordKey)!.target),
        })),
      ),
      choices: JSON.stringify(choices),
    }));
  if (choices === null) return null;
  const values = applyJointConflictChoices(prepared, choices);
  if (
    !(await confirmEntityIdChanges(
      feedback,
      prepared.snapshot.records.flatMap((record) => {
        const next = values[record.key];
        return record.target.kind === 'spec' && record.value.state === 'present' && next?.state === 'present'
          ? [
              {
                target: record.target.target,
                before: record.value.value as RowData,
                after: next.value as RowData,
                composition: record.composition,
              },
            ]
          : [];
      }),
    ))
  )
    return null;
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
    infoLog('joint.targets_decided', () => ({
      ...context,
      status: confirmed === 'save' ? 'confirmed' : 'cancelled',
      targets: JSON.stringify(
        [...new Set([...overrides, ...shared])].map((record) => ({
          recordKey: record.key,
          ...logIdentity(record.target),
          referencedBy: record.referencedBy,
          override: overrides.includes(record),
        })),
      ),
    }));
    if (confirmed !== 'save') return null;
  }
  infoLog('joint.targets_submitted', () => ({
    ...context,
    targets: JSON.stringify(
      prepared.snapshot.records
        .filter((record) => Object.hasOwn(values, record.key))
        .map((record) => ({ recordKey: record.key, ...logIdentity(record.target) })),
    ),
  }));
  const result = await runConfirmedJsonWrite(
    feedback,
    (jsonWrite) =>
      saveJointEdit(
        {
          snapshot: prepared.snapshot,
          values,
          baseVersions: prepared.snapshot.baseVersions,
          jsonWrite,
          createOverrides,
        },
        request,
      ),
    replaced.replacePaths,
    request.id,
  );
  if (!result) return null;
  return result;
}
