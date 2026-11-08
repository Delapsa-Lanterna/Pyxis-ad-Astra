import { ref } from 'vue';
import { changeWeaponSpecClass } from '@/domain/entity-write/spec-construction';
import { dialogBody, dialogFiles, dialogSelect } from '@/shared/ui/dialog-content';
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
  WeaponSpecClass,
} from '@/shared/types';
import { queryJointEdit, queryJointEditRow, prepareJointEdit, saveJointEdit } from '@/services/joint-edit.service';
import { confirmEntityIdChanges, entityChangeContent, entityIdPresenceChanged } from '@/orchestrators/entity-write.orchestrator';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { jointObject, applyJointConflictChoices, takeJointReplaceBase } from '@/domain/joint-edit';
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
    sourcePath: source.source?.path ?? null,
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
  const identityChanges = prepared.snapshot.records
    .flatMap((record) => {
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
    })
    .filter(entityIdPresenceChanged);
  const overrides = prepared.snapshot.records.filter(
    (record) =>
      Object.hasOwn(values, record.key) &&
      record.source &&
      record.source.source !== 'mod' &&
      (createOverrides.includes(record.key) || JSON.stringify(values[record.key]) !== JSON.stringify(record.value)),
  );
  const shared = prepared.snapshot.records.filter(
    (record) =>
      Object.hasOwn(values, record.key) &&
      record.referencedBy.length > 1 &&
      JSON.stringify(values[record.key]) !== JSON.stringify(record.value),
  );
  const branches = overrides
    .filter(
      (record) =>
        record.target.kind === 'spec' && record.target.target.kind === 'weapon' && jointObject(values[record.key]).specClass === 'pulse',
    )
    .map((record) => ({ record, selected: ref<WeaponSpecClass>('projectile') }));
  const affected = prepared.snapshot.records.filter(
    (record) =>
      overrides.includes(record) ||
      shared.includes(record) ||
      identityChanges.some((change) => record.target.kind === 'spec' && change.target.write.path === record.target.target.write.path),
  );
  const confirmed = await confirmEntityIdChanges(
    feedback,
    [],
    affected.map((record) => () => {
      const path = record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path;
      const change = identityChanges.find((change) => change.target.write.path === path),
        branch = branches.find((branch) => branch.record === record);
      return dialogBody(
        ...(change ? [entityChangeContent(change)] : []),
        ...(overrides.includes(record)
          ? [
              '将原文件的修改保存到当前 Mod：',
              '原文件：',
              dialogFiles([record.source!.path]),
              ...(change ? [] : ['保存位置：', dialogFiles([path])]),
            ]
          : change
            ? []
            : [dialogFiles([path])]),
        ...(record.referencedBy.length > 1
          ? ['保存后会影响以下 ' + record.referencedBy.length + ' 个对象：', dialogFiles(record.referencedBy)]
          : []),
        ...(branch
          ? [
              `武器 ${record.target.kind === 'spec' ? record.target.target.id : record.key} 当前使用 pulse 分支，请选择本地覆盖采用的分支。`,
              dialogSelect('武器分支', branch.selected, [
                { label: '弹体武器', value: 'projectile' },
                { label: '光束武器', value: 'beam' },
              ]),
              '按' + (branch.selected.value === 'beam' ? '光束' : '弹体') + '武器分支调整当前内容，并保存到上述本地文件。',
            ]
          : []),
      );
    }),
    branches.length ? '创建本地覆盖' : '保存',
  );
  if (affected.length) {
    infoLog('joint.targets_decided', () => ({
      ...context,
      status: confirmed ? 'confirmed' : 'cancelled',
      targets: JSON.stringify(
        affected.map((record) => ({
          recordKey: record.key,
          ...logIdentity(record.target),
          referencedBy: record.referencedBy,
          override: overrides.includes(record),
        })),
      ),
    }));
  }
  if (!confirmed) return null;
  for (const { record, selected } of branches)
    values[record.key] = { state: 'present', value: changeWeaponSpecClass(jointObject(values[record.key]), selected.value) };

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
