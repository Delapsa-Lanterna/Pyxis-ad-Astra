import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { warningNotice } from '@/shared/lib/errors';

export function useFieldOptionMedia() {
  const feedback = useAppFeedback();
  const registry = useResourceMediaRegistry({
    onError: (error, context) => feedback.error(error, '读取选项贴图失败', context),
    onFailures: (resources, context) =>
      feedback.warning(
        warningNotice(`读取选项贴图失败：${resources.length} 个资源读取失败`, 'resource.not_found', JSON.stringify(resources)),
        context,
      ),
  });
  return {
    dataUrl: registry.dataUrl,
    replaceCollection: registry.replaceCollection,
    releaseCollection: registry.releaseCollection,
  };
}
