import { defineRule } from '../../../diagnostics.mjs';
import { classifyFrontendPath } from '../../../facts/classify.mjs';

export const feedbackBoundaryRule = defineRule(
  'feedback-boundary',
  '.zcode/modules/app-feedback.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const current = file.role;
      if (current.layer === 'app' && current.domain === 'app-feedback')
        for (const edge of file.dependencies) {
          const target = classifyFrontendPath(edge.resolved);
          const log = current.role === 'module' && target.layer === 'services' && target.domain === 'app-log';
          if (!['shared', 'external'].includes(target.layer) && !log)
            report(
              file,
              edge,
              'feedback presentation and injection must consume shared contracts; recovery belongs to application assembly',
              { target: edge.resolved, expected: 'shared contract' },
            );
        }
      if (
        current.layer === 'shared' &&
        current.domain === 'types' &&
        file.frontend.declarations.some((declaration) => declaration.name === 'AppSettings') &&
        file.frontend.declarations.some((declaration) => ['AppLogLevel', 'AppLogEntry', 'AppLogStatus'].includes(declaration.name))
      )
        report(file, { line: 1, column: 1 }, 'app settings and app log wire types must live in separate shared type ownership files');
      if (current.layer === 'services' && current.domain === 'app-log')
        for (const edge of file.dependencies)
          if (edge.bindings.some((binding) => binding.importedName === 'AppSettings'))
            report(file, edge, 'app log service must consume app log types', { target: edge.resolved, expected: 'app log types' });
    }
  },
);
