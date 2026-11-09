import { defineRule } from '../../../diagnostics.mjs';
import { classifyFrontendPath } from '../../../facts/classify.mjs';
import { dependencyOrigins } from '../../../facts/imports.mjs';

const implementations = new Set([
  'spec-editor-assembly',
  'spec-editor-draft-images',
  'spec-ship-editor',
  'spec-weapon-editor',
  'spec-projectile-editor',
  'spec-system-editor',
]);

export const editorModuleBoundaryRule = defineRule(
  'editor-module-boundary',
  '.zcode/modules/spec-editor.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      if (file.role.domain !== 'spec-editor-window-view-model') continue;
      for (const edge of file.dependencies)
        for (const origin of dependencyOrigins(edge, context.byPath, () => false, undefined, true)) {
          const target = classifyFrontendPath(origin.rel);
          if (implementations.has(target.domain ?? '') || (target.layer === 'app' && target.role === 'component'))
            report(file, edge, 'shared spec session must consume injected editor definitions', {
              target: origin.rel,
              symbol: origin.name,
              expected: 'injected editor definition',
            });
        }
    }
  },
);
