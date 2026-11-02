import { dialogBody, dialogFiles } from '@/shared/ui/dialog-content';
import type { AppFeedback, JsonSourceConfirmation, JsonWriteOptions } from '@/shared/types';
import { infoLog } from '@/shared/runtime/app-log-queue';
import { commandErrorCode, errorContextOf } from '@/shared/lib/errors';
import { useSettingsStore } from '@/stores/settings.store';

interface RewriteFile extends JsonSourceConfirmation {
  reason: string;
}

function rewriteFiles(error: unknown): RewriteFile[] | null {
  if (error instanceof Error && 'cause' in error) return rewriteFiles(error.cause);
  if (commandErrorCode(error) === 'json.rewrite_confirmation_required' && typeof error === 'object' && error !== null) {
    const files = (error as { files?: unknown }).files;
    if (!Array.isArray(files)) return null;
    const valid = files.every(
      (file) =>
        typeof file === 'object' &&
        file !== null &&
        typeof file.path === 'string' &&
        typeof file.reason === 'string' &&
        typeof file.sourceFingerprint === 'string',
    );
    return valid ? (files as RewriteFile[]) : null;
  }
  return null;
}

export async function runConfirmedJsonWrite<T>(
  feedback: AppFeedback | undefined,
  write: (options: JsonWriteOptions) => Promise<T>,
  replacePaths: string[] = [],
  requestId = '',
): Promise<T | null> {
  const preserveOriginalJson = feedback ? useSettingsStore().preserveOriginalJson : false;
  let confirmedSources: JsonSourceConfirmation[] = [];
  for (;;) {
    try {
      return await write({ preserveOriginalJson, confirmedSources, ...(replacePaths.length ? { replacePaths } : {}) });
    } catch (error) {
      if (!preserveOriginalJson || !feedback) throw error;
      requestId ||= errorContextOf(error)['request.id'] ?? '';
      const files = rewriteFiles(error);
      if (!files?.length) throw error;
      const choice = await feedback.choose({
        title: '重排这些 JSON 文件并保存？',
        cancelText: '返回编辑',
        content: () =>
          dialogBody(
            (files.length === 1 ? '这个文件' : '以下 ' + files.length + ' 个文件') + '需要整体重排。保存后采用标准排版，并移除已有注释。',
            ...files.map((file) => dialogBody(dialogFiles([file.path]), '原因：' + file.reason)),
          ),
        choices: [{ label: '重排并保存', value: 'rewrite', type: 'warning' }],
      });
      for (const file of files)
        infoLog('save.json_rewrite_decided', () => ({
          requestId,
          path: file.path,
          sourceFingerprint: file.sourceFingerprint,
          reason: file.reason,
          status: choice === 'rewrite' ? 'confirmed' : 'cancelled',
        }));
      if (choice !== 'rewrite') return null;
      confirmedSources = files.map(({ path, sourceFingerprint }) => ({ path, sourceFingerprint }));
    }
  }
}
