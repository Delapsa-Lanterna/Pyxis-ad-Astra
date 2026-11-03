import { dialogBody, dialogFiles, dialogSelect } from '@/shared/ui/dialog-content';
import { ref } from 'vue';
import type { EntityEditTarget, AppFeedback, EntityIdentityIntent, RowData, JsonComposition } from '@/shared/types';
import { entityContentIdField, trimmedEntityStringField } from '@/domain/project/entity-definitions';
import { composeJson } from '@/domain/json-composition';

interface EntityIdChange {
  target: EntityEditTarget;
  before: RowData;
  after: RowData;
  composition?: JsonComposition;
}
const entityNames = {
  faction: '势力',
  skin: '皮肤',
  variant: '装配',
  projectile: '弹体',
  ship: '舰船',
  weapon: '武器',
  system: '战术系统',
  skill: '技能',
  mission: '战役',
};
export function entityIdPresenceChanged({ target, before, after }: EntityIdChange) {
  const field = entityContentIdField(target.kind);
  return Boolean(trimmedEntityStringField(before, field)) !== Boolean(trimmedEntityStringField(after, field));
}
function baseSources(composition: JsonComposition | undefined, field: string) {
  return (composition?.layers ?? []).map(({ source, data }) =>
    dialogBody(
      source.source === 'core' ? '原版文件：' : '基础来源：' + (source.reference?.modRoot ?? source.root),
      dialogFiles([source.path]),
      '提供的 ID：' + String(data[field] ?? '尚未提供'),
    ),
  );
}
export function entityChangeContent({ target, before, after, composition }: EntityIdChange) {
  const field = entityContentIdField(target.kind),
    previous = trimmedEntityStringField(before, field),
    next = trimmedEntityStringField(after, field),
    baseId = composeJson({}, composition)[field];
  const name = target.write.relPath.split('/').at(-1)!,
    stem = name.replace(/\.[^.]+$/, '');
  return dialogBody(
    after[field] === ''
      ? `将这份文件的 ${field} 保存为空字符串。`
      : next
        ? `为这份文件填写本地 ID ${next}，保存后按自持文件检查必填内容。`
        : `删除这份文件中的本地 ID ${previous}，${baseId ? '沿用基础来源提供的 ' + String(baseId) + '，' : ''}作为局部覆盖保存。`,
    dialogFiles([target.write.path]),
    ...(!next
      ? [
          after[field] === ''
            ? `空字符串会写入文件，并覆盖基础来源中的 ID ${baseId ?? '尚未提供'}。工具使用文件名 ${stem} 定位这份文件。`
            : !baseId
              ? `当前基础来源也没有提供${entityNames[target.kind]} ID。工具将使用文件名 ${stem} 定位这份文件。`
              : '',
          '必填字段可以省略，填写的内容仍会检查类型和取值。',
        ].filter(Boolean)
      : []),
    '文件名保持 ' + name + '。',
    ...baseSources(composition, field),
  );
}
export async function confirmEntityIdChanges(
  feedback: AppFeedback | undefined,
  changes: EntityIdChange[],
  additional: Array<ReturnType<typeof dialogBody> | (() => ReturnType<typeof dialogBody>)> = [],
  actionText = '保存',
): Promise<boolean> {
  const affected = [...new Map(changes.map((change) => [change.target.write.path, change])).values()].filter(entityIdPresenceChanged);
  if (!affected.length && !additional.length) return true;
  if (!feedback) return false;
  return (
    (await feedback.choose({
      title: '保存这些文件？',
      cancelText: '返回编辑',
      content: () =>
        dialogBody(...affected.map(entityChangeContent), ...additional.map((item) => (typeof item === 'function' ? item() : item))),
      choices: [{ label: actionText, value: 'save', type: 'warning' }],
    })) === 'save'
  );
}
/** Settles the captured identity and filename together before submitting the save. */
export async function chooseEntityFilename(
  feedback: AppFeedback | undefined,
  source: EntityEditTarget,
  intent: Pick<EntityIdentityIntent, 'nextId' | 'nextWrite' | 'filenameTaken' | 'inherits'>,
  content?: Omit<EntityIdChange, 'target'>,
): Promise<boolean | null> {
  const change = content && { ...content, target: source };
  const filenameChoice = source.state !== 'create' && source.id !== intent.nextId && (intent.filenameTaken || intent.inherits);
  if (!filenameChoice && (!change || !entityIdPresenceChanged(change))) return false;
  if (!feedback) return null;
  const field = entityContentIdField(source.kind),
    filenameId = source.write.relPath
      .split('/')
      .at(-1)!
      .replace(/\.[^.]+$/, '');
  const keptId = change ? String(composeJson(change.after, change.composition)[field] || filenameId) : intent.nextId;
  const registration =
    source.kind === 'faction'
      ? source.linkedRecord?.kind === 'index'
        ? ['同时更新本地 factions.csv 中的现有登记：', '原登记：' + source.write.relPath, '保存后：' + intent.nextWrite.relPath]
        : ['在本地 factions.csv 新增这份文件的登记。']
      : [];
  const handling = ref(intent.filenameTaken ? 'keep' : 'rename');
  const choice = await feedback.choose({
    title: intent.filenameTaken ? '目标文件名已被占用' : '保存' + entityNames[source.kind] + '修改？',
    cancelText: '返回编辑',
    content: () =>
      filenameChoice
        ? dialogBody(
            change && !trimmedEntityStringField(change.after, field)
              ? (change.after[field] === ''
                  ? '将本地身份字段保存为空字符串，覆盖基础来源提供的 ID。'
                  : '删除文件中的本地 ID，沿用基础来源提供的身份。') + '作为局部覆盖保存；必填字段可以省略，填写的内容仍会检查类型和取值。'
              : '将本地 ID ' + source.id + ' 改为 ' + intent.nextId + '。',
            '当前文件：',
            dialogFiles([source.write.path]),
            ...(intent.filenameTaken
              ? ['目标文件名已经存在：', dialogFiles([intent.nextWrite.path]), '本次保留当前文件名。']
              : [
                  dialogSelect('文件名处理', handling, [
                    { label: '更改文件名', value: 'rename' },
                    { label: '保留文件名', value: 'keep' },
                  ]),
                ]),
            ...(handling.value === 'rename'
              ? [
                  '保存到：',
                  dialogFiles([intent.nextWrite.path]),
                  ...registration,
                  ...(intent.inherits ? ['原来的 ' + source.id + ' 恢复使用基础来源。'] : []),
                  '新文件需要满足新路径下的必填要求。',
                ]
              : [
                  `继续保存到当前文件，${entityNames[source.kind]} ID 使用 ${keptId}。`,
                  ...(intent.inherits ? ['继续沿用该路径的基础内容。'] : []),
                  ...(source.kind === 'faction' ? ['继续沿用当前路径的登记关系。'] : []),
                ]),
            ...baseSources(content?.composition, field),
          )
        : dialogBody(
            entityChangeContent({ ...change!, target: { ...source, write: intent.nextWrite } }),
            ...(source.write.path !== intent.nextWrite.path ? ['原文件：', dialogFiles([source.write.path]), ...registration] : []),
          ),
    choices: [{ label: '保存', value: 'save', type: 'warning' }],
  });
  return choice === 'save' ? Boolean(filenameChoice && handling.value === 'keep') : null;
}
