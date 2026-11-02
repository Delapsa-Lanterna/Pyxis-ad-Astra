import type { EntityEditTarget, AppFeedback, EntityIdentityIntent } from '@/shared/types';

/**
 * A changed ID renames the file by default. The user is asked only when renaming would lose the
 * same-path inheritance or the new file name is taken; both prompts offer keeping the current name.
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
    title: '无法直接改名',
    content: `当前文件：${source.write.relPath}\n${reasons.join('\n')}\n可保留当前文件名保存新 ID。`,
    choices: [{ label: '保留文件名', value: 'keep', type: 'warning' }],
  });
  return choice === 'keep' ? true : null;
}
