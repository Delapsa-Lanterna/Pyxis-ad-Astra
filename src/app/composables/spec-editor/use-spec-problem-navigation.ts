import { onScopeDispose, provide, type InjectionKey, type Ref } from 'vue';
import type { FieldProblem } from '@/shared/types';
import type { SpecSection } from '@/domain/spec-editor/spec-fields';
import type { useEditorDocument } from '@/app/composables/editors/use-editor-document';
import { scrollEditorTarget } from '@/app/components/editors/common/editor-collapse';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

export const specProblemNavigationKey: InjectionKey<(issue: FieldProblem) => void> = Symbol('spec-problem-navigation');
export function useSpecProblemNavigation(options: {
  root: Readonly<Ref<HTMLElement | null>>;
  document: ReturnType<typeof useEditorDocument>;
  expanded: Ref<(string | number)[]>;
  sections: () => SpecSection[];
  prepare?: (path: string) => string | undefined;
}) {
  let revision = 0;
  const feedback = useAppFeedback();
  onScopeDispose(() => revision++);
  provide(specProblemNavigationKey, (issue) => {
    const captured = ++revision,
      accepts = options.document.captureActionContext();
    const current = () => captured === revision && accepts();
    const reveal = () => {
      if (!current()) return;
      const parts = issue.path.replace(/\["([^"]+)"\]/g, '.$1');
      const sections = options.sections();
      const prepared = options.prepare?.(issue.path);
      const section =
        sections.find(
          (section) =>
            section.name === prepared ||
            section.fields.some((field) => parts === field.key || parts.startsWith(field.key + '.') || parts.startsWith(field.key + '[')),
        )?.name ?? sections[0]!.name;
      options.expanded.value = [section];
      const paths = [issue.path, parts, ...Array.from(parts.matchAll(/[.[]/g), (match) => parts.slice(0, match.index)).reverse()];
      const selectors = [...new Set(paths)].map((path) => `[data-field-path="${CSS.escape(path)}"]`);
      selectors.push('.n-collapse-item--active');
      void scrollEditorTarget(options.root.value!, selectors, current).catch((error: unknown) => feedback.error(error));
    };
    if (issue.code === 'field.input_invalid') reveal();
    else void options.document.run(reveal);
  });
}
