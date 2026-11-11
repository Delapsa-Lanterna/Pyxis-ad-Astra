import { ref } from 'vue';
import { queryJointEdit, queryJointEditRow, queryJointEditPreview, prepareJointEdit, saveJointEdit } from '@/services/joint-edit.service';
import { useSettingsStore } from '@/stores/settings.store';
import { createJsonDocument } from '@/domain/json-document';
import { prepareValue } from '@/domain/schema/game-number';
import { prepareSchemaAtPath } from '@/domain/schema/schema-values';
import { getSchema } from '@/domain/schema/config-schema-registry';
import { applyJointConflictChoices, jointCsvProblems, jointObject, jointProblemBlocks, takeJointReplaceBase } from '@/domain/joint-edit';
import { changeWeaponSpecClass } from '@/domain/entity-write/spec-construction';
import { confirmEntityIdChanges, entityChangeContent, entityIdPresenceChanged } from './entity-write.orchestrator';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { AppError } from '@/shared/lib/errors';
import { dialogBody, dialogFiles, dialogSelect } from '@/shared/ui/dialog-content';
import { infoLog } from '@/shared/runtime/app-log-queue';
import { prepareCsvValue } from '@/domain/schema/csv-value-validation';
import { cell } from '@/shared/lib/starsector';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';
import type { DocumentEdit, JsonFileWrite } from '@/shared/types';
import type {
  JointEditRoot,
  JointEditSnapshot,
  JointEditDraft,
  JointEditPrepared,
  JointConflictChoice,
  JointEditWriteResult,
  AppFeedback,
  JointValue,
  FieldProblem,
  RowData,
  WeaponSpecClass,
  JointEditRecord,
  JsonValue,
} from '@/shared/types';

export async function resolveWingReference(root: JointEditRoot, destination: 'hull' | 'variant', signal?: AbortSignal) {
  const snapshot = await queryJointEdit(root, signal),
    key = destination === 'variant' ? snapshot.bindings.variant : snapshot.bindings.hull;
  const record = snapshot.records.find((record) => record.key === key);
  if (!record || record.value.state !== 'present' || record.target.kind !== 'spec')
    throw new AppError(destination === 'hull' ? '找不到联队引用的船体' : '找不到联队引用的装配', { action: 'navigate-wing-reference' });
  const target = record.target.target,
    kind = target.kind === 'skin' ? 'skin' : target.kind === 'variant' ? 'variant' : 'ship';
  const source = kind === 'ship' ? snapshot.records.find((record) => record.key === snapshot.hull!.displayBindings.csv)! : record;
  return {
    kind: kind as 'skin' | 'variant' | 'ship',
    id: target.id,
    source: source.source?.source ?? null,
    sourcePath: source.source?.path ?? null,
    rowKey: source.target.kind === 'csv' ? source.target.rowKey : undefined,
  };
}
export async function openJointEditSnapshot(root: JointEditRoot, signal?: AbortSignal): Promise<JointEditSnapshot | null> {
  return cloneQuerySnapshot<JointEditSnapshot>(await queryJointEdit(root, signal));
}
export async function openJointEditRowSnapshot(root: Omit<JointEditRoot, 'id'>, rowKey: string): Promise<JointEditSnapshot | null> {
  return cloneQuerySnapshot<JointEditSnapshot>(await queryJointEditRow(root, rowKey));
}

export async function submitJointEdit(
  draft: JointEditDraft,
  feedback: AppFeedback,
  chooseConflicts: (prepared: JointEditPrepared) => Promise<JointConflictChoice[] | null>,
  createOverrides: string[] = [],
  request: SaveCommandRequest = { id: crypto.randomUUID() },
  validate?: (
    snapshot: JointEditSnapshot,
    values: Record<string, JointValue>,
    signal?: AbortSignal,
    createOverrides?: readonly string[],
    preparedSnapshot?: JointEditSnapshot,
  ) => Promise<FieldProblem[]>,
  previewInputs?: (snapshot: JointEditSnapshot, values: Record<string, JointValue>) => JsonValue,
): Promise<JointEditWriteResult | null> {
  const replacement = takeJointReplaceBase(draft.baseline, draft.values);
  const prepared = cloneQuerySnapshot<JointEditPrepared>(await prepareJointEdit({ ...draft, values: replacement.values }));
  const choices = prepared.conflicts.length ? await chooseConflicts(prepared) : [];
  if (choices === null) return null;
  const values = applyJointConflictChoices(prepared, choices),
    snapshot = prepared.snapshot;
  const changes = snapshot.records
    .flatMap((record) => {
      const value = values[record.key];
      return record.target.kind === 'spec' && record.value.state === 'present' && value?.state === 'present'
        ? [
            {
              target: record.target.target,
              before: record.value.value as RowData,
              after: value.value as RowData,
              composition: record.composition,
            },
          ]
        : [];
    })
    .filter(entityIdPresenceChanged);
  const changed = snapshot.records.filter(
    (record) => Object.hasOwn(values, record.key) && !stableDeepEqual(record.value, values[record.key]),
  );
  const overrides = snapshot.records.filter(
    (record) => record.source && record.source.source !== 'mod' && (changed.includes(record) || createOverrides.includes(record.key)),
  );
  const affected = snapshot.records.filter(
    (record) =>
      overrides.includes(record) ||
      (changed.includes(record) && record.referencedBy.length > 1) ||
      (record.target.kind === 'spec' &&
        changes.some((change) => change.target.write.path === (record.target.kind === 'spec' ? record.target.target.write.path : ''))),
  );
  const branches = overrides
    .filter(
      (record) =>
        record.target.kind === 'spec' && record.target.target.kind === 'weapon' && jointObject(values[record.key]).specClass === 'pulse',
    )
    .map((record) => ({ record, selected: ref<WeaponSpecClass>('projectile') }));
  const confirmed = await confirmEntityIdChanges(
    feedback,
    [],
    affected.map((record) => () => {
      const path = record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path;
      const change = changes.find((change) => change.target.write.path === path),
        branch = branches.find((branch) => branch.record === record);
      return dialogBody(
        ...(change ? [entityChangeContent(change)] : []),
        ...(overrides.includes(record) ? ['将来源内容保存到当前 Mod：', dialogFiles([record.source!.path, path])] : [dialogFiles([path])]),
        ...(record.referencedBy.length > 1 ? ['保存后会影响以下对象：', dialogFiles(record.referencedBy)] : []),
        ...(branch
          ? [
              dialogSelect('武器分支', branch.selected, [
                { label: '弹体武器', value: 'projectile' },
                { label: '光束武器', value: 'beam' },
              ]),
            ]
          : []),
      );
    }),
    branches.length ? '创建本地覆盖' : '保存',
  );
  infoLog('joint.targets_decided', () => ({ ...snapshot.root, status: confirmed ? 'confirmed' : 'cancelled' }));
  if (!confirmed) return null;
  for (const branch of branches)
    values[branch.record.key] = {
      state: 'present',
      value: changeWeaponSpecClass(jointObject(values[branch.record.key]), branch.selected.value),
    };
  let preview: JointEditSnapshot | undefined;
  if (validate) {
    const original = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
    preview =
      previewInputs && stableDeepEqual(previewInputs(snapshot, values), previewInputs(snapshot, original))
        ? snapshot
        : cloneQuerySnapshot<JointEditSnapshot>(await queryJointEditPreview({ baseline: snapshot, values }));
    for (const record of preview.records)
      if (!snapshot.records.some((current) => current.key === record.key))
        snapshot.records.push(cloneQuerySnapshot<JointEditRecord>(record));
    for (const version of preview.baseVersions)
      if (!snapshot.baseVersions.some((current) => current.path === version.path)) snapshot.baseVersions.push({ ...version });
  }
  const issues = validate
    ? (await validate(snapshot, values, undefined, createOverrides, preview)).filter((issue) =>
        jointProblemBlocks(snapshot, values, issue, createOverrides),
      )
    : jointCsvProblems(snapshot, values);
  if (issues.some((issue) => issue.severity === 'error'))
    throw new AppError('请先解决联合文件中的错误', { action: 'joint-validation', issues });
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  if (
    warnings.length &&
    !useSettingsStore().ignoreEditorWarnings &&
    (await feedback.choose({
      title: '仍要保存吗？',
      content: () => dialogBody(`联合文件有 ${warnings.length} 条保存提醒：`, ...warnings.map((issue) => issue.message)),
      choices: [{ label: '仍然保存', value: 'save', type: 'warning' }],
      cancelText: '返回编辑',
    })) !== 'save'
  )
    return null;
  const documents: Record<string, JsonFileWrite> = {},
    csvColumns: Record<string, string[]> = {};
  const edits: DocumentEdit[] = [];
  const layout = useSettingsStore().preserveStructure ? 'preserveStructure' : 'expanded';
  for (const record of snapshot.records) {
    const next = values[record.key];
    if (!next || next.state === 'missing') continue;
    if (record.target.kind === 'spec') {
      if (stableDeepEqual(next, record.value) && !createOverrides.includes(record.key)) continue;
      const schema = getSchema(
        ['ship', 'weapon', 'projectile', 'system'].includes(record.target.target.kind)
          ? 'spec-' + record.target.target.kind
          : record.target.target.kind,
      );
      const owner = createJsonDocument(record.document, {
        value: prepareValue(record.value.state === 'present' ? record.value.value : next.value).value,
      });
      owner.update(next.value, (value, path) => (schema ? prepareSchemaAtPath(value, path, schema) : prepareValue(value)));
      const captured = owner.capture(layout);
      documents[record.key] = captured.request;
      edits.push(...captured.edits.map((edit) => ({ ...edit, path: [record.key, 'value', ...edit.path] })));
    } else if (record.target.kind === 'csv') {
      const before = jointObject(record.value),
        after = jointObject(next),
        columns = getCsvColumnSchemas(record.target.table);
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !stableDeepEqual(before[key], after[key]));
      csvColumns[record.key] = keys;
      values[record.key] = {
        state: 'present',
        value: {
          ...after,
          ...Object.fromEntries(
            keys.map((key) => {
              const column = columns.find((column) => column.key === key);
              return [key, column ? prepareCsvValue(column, cell(after[key])) : cell(after[key])];
            }),
          ),
        },
      };
      for (const key of keys)
        edits.push({ kind: 'replace', path: [record.key, 'value', key], value: prepareValue(jointObject(values[record.key])[key]) });
    } else if (!stableDeepEqual(next, record.value)) {
      edits.push({ kind: 'replace', path: [record.key, 'value'], value: prepareValue(next.value) });
    }
  }
  infoLog('joint.targets_submitted', () => ({ ...snapshot.root, requestId: request.id, targets: JSON.stringify(Object.keys(values)) }));
  return saveJointEdit(
    {
      snapshot,
      values,
      documents,
      csvColumns,
      baseVersions: snapshot.baseVersions,
      createOverrides,
      jsonWrite: { preserveStructure: layout === 'preserveStructure', replacePaths: replacement.replacePaths },
    },
    edits,
    request,
  );
}
