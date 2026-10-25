import { defineRule } from '../../../diagnostics.mjs';
import { classifyFrontendPath } from '../../../facts/classify.mjs';

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
      for (const edge of file.dependencies) {
        const target = classifyFrontendPath(edge.resolved);
        if (implementations.has(target.domain ?? '') || (target.layer === 'app' && target.role === 'component'))
          report(file, edge, 'shared spec session must consume injected editor definitions', {
            target: edge.resolved,
            expected: 'injected editor definition',
          });
      }
    }
  },
);
