import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { openConfigFolder } from '@/services/app-config.service';

export function useAppConfigActions() {
  const feedback = useAppFeedback();
  async function openConfigFolderAction() {
    try {
      await openConfigFolder();
    } catch (error) {
      feedback.error(error, '打开配置文件夹失败');
    }
  }
  return { openConfigFolderAction };
}
