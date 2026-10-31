import type { EntityEditTarget, AppFeedback } from '@/shared/types';
export async function chooseEntityFilename(feedback: AppFeedback | undefined, source: EntityEditTarget, nextId: string) {
  if (!feedback || source.state === 'create' || source.id === nextId) return false;
  const nextPath = source.write.relPath.replace(/[^/]+$/, nextId + source.write.relPath.slice(source.write.relPath.lastIndexOf('.')));
  const choice = await feedback.choose({
    title: '修改 ID 后如何保存？',
    content: `当前文件：${source.write.relPath}\n改名目标：${nextPath}\n同路径基础内容随文件路径变化；保留文件名将继续匹配当前路径。`,
    choices: [
      { label: '同时改名', value: 'rename', type: 'warning' },
      { label: '保留文件名', value: 'keep' },
    ],
  });
  return choice === null ? null : choice === 'keep';
}
