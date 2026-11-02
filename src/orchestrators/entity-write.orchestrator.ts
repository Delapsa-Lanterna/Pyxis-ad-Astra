import type { EntityEditTarget, AppFeedback, EntityIdentityIntent, RowData, JsonComposition } from '@/shared/types';
import { entityContentIdField, trimmedEntityStringField } from '@/domain/project/entity-definitions';
import { composeJson } from '@/domain/schema/json-composition';

interface EntityIdChange {
  target: EntityEditTarget;
  before: RowData;
  after: RowData;
  composition?: JsonComposition;
  keepFilename?: boolean;
}

export async function confirmEntityIdChanges(feedback: AppFeedback | undefined, changes: EntityIdChange[]): Promise<boolean> {
  const affected = [...new Map(changes.map((change) => [change.target.write.path, change])).values()].filter(
    ({ target, before, after }) => {
      const field = entityContentIdField(target.kind);
      return Boolean(trimmedEntityStringField(before, field)) !== Boolean(trimmedEntityStringField(after, field));
    },
  );
  if (!affected.length) return true;
  if (!feedback) return false;
  const choice = await feedback.choose({
    title: '确认 ID 状态变化',
    content: affected
      .map(({ target, before, after, composition, keepFilename }) => {
        const field = entityContentIdField(target.kind),
          previous = trimmedEntityStringField(before, field),
          next = trimmedEntityStringField(after, field);
        const name = target.write.relPath.split('/').at(-1)!,
          extension = name.slice(name.lastIndexOf('.'));
        const nextId = next || name.slice(0, -extension.length);
        const baseId = String(composeJson({}, composition)[field] ?? '');
        const effectiveId = !keepFilename && nextId + extension !== name ? next : String(composeJson(after, composition)[field] ?? '');
        return [
          target.write.relPath,
          `本地 ${field}：${previous || '无 ID'} → ${next || '无 ID'}`,
          next ? '保存后采用所属格式的完整性校验。' : '保存后按局部覆盖处理，必填字段允许缺省。',
          `基础来源 ID：${baseId || '未提供'}；组合后的 ID：${effectiveId || '未提供'}`,
          `文件名：${name} → ${keepFilename ? name : nextId + extension}`,
          `工具定位与关联身份：${target.id} → ${nextId}`,
        ].join('\n');
      })
      .join('\n\n'),
    choices: [
      { label: '确认变化并保存', value: 'save', type: 'warning' },
      { label: '返回编辑', value: 'cancel' },
    ],
  });
  return choice === 'save';
}

/**
 * A changed ID renames the file by default. The user is asked only when renaming would lose the
 * same-path inheritance or the new file name is taken; available destinations also offer renaming.
 * Returns whether to keep the file name, or null when the save is cancelled.
 */
export async function chooseEntityFilename(
  feedback: AppFeedback | undefined,
  source: EntityEditTarget,
  intent: Pick<EntityIdentityIntent, 'nextId' | 'nextWrite' | 'filenameTaken' | 'inherits'>,
): Promise<boolean | null> {
  if (source.state === 'create' || source.id === intent.nextId) return false;
  const reasons = [
    intent.filenameTaken ? `目标文件已存在：${intent.nextWrite.relPath}` : '',
    intent.inherits ? '当前文件与原版或引用 Mod 同路径组合，改名后将不再继承基础内容，旧 ID 的基础实体也会重新生效。' : '',
  ].filter(Boolean);
  if (!reasons.length) return false;
  if (!feedback) return null;
  const choice = await feedback.choose({
    title: intent.filenameTaken ? '目标文件名已被占用' : '确认文件名变化',
    content: `当前文件：${source.write.relPath}\n目标文件：${intent.nextWrite.relPath}\n${reasons.join('\n')}`,
    choices: [
      ...(!intent.filenameTaken ? [{ label: '更改文件名', value: 'rename', type: 'warning' as const }] : []),
      { label: '保留文件名', value: 'keep', type: 'warning' },
    ],
  });
  return choice === 'keep' ? true : choice === 'rename' ? false : null;
}
