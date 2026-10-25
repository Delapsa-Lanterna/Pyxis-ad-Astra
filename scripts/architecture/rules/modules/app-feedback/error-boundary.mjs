import { defineRule } from '../../../diagnostics.mjs';

export const errorBoundaryRule = defineRule(
  'error-boundary',
  '.zcode/frontend-guidelines.md#错误与反馈',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      if (!['services', 'orchestrators'].includes(file.role.layer)) continue;
      for (const failure of file.frontend.throws)
        if (failure.name === 'Error')
          report(file, failure, 'service/orchestrator failures must throw AppError with an action', {
            symbol: failure.name,
            expected: 'AppError',
          });
    }
  },
);
