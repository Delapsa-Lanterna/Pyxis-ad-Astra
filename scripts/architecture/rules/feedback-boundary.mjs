import { frontendFile, specFile } from '../../shared/files.mjs';
import { classifyFrontendPath } from '../../shared/classify.mjs';
import { importedProjectPaths } from '../../shared/imports.mjs';
import { dependencyDiagnostic } from '../../shared/frontend-policy.mjs';

export const feedbackBoundaryRule = {
  name: 'feedback-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel) || specFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      if (current.layer === 'app' && current.domain === 'app-feedback')
        for (const edge of importedProjectPaths(file)) {
          const target = classifyFrontendPath(edge.resolved);
          const log = current.role === 'module' && target.layer === 'services' && target.domain === 'app-log';
          if (!['shared', 'external'].includes(target.layer) && !log)
            failures.push(
              dependencyDiagnostic(
                file,
                edge,
                'feedback presentation and injection must consume shared contracts; recovery belongs to application assembly',
              ),
            );
        }
      if (
        current.layer === 'shared' &&
        current.domain === 'types' &&
        /\b(?:interface|type|const|enum)\s+[A-Za-z0-9_]+/.test(file.text) &&
        /\bAppSettings\b/.test(file.text) &&
        /\b(?:APP_LOG_LEVELS|AppLogLevel|AppLogEntry|AppLogStatus)\b/.test(file.text)
      )
        failures.push(`${file.rel}: app settings and app log wire types must live in separate shared type ownership files`);
      if (current.layer === 'services' && current.domain === 'app-log') {
        for (const edge of importedProjectPaths(file)) {
          if (edge.bindings.some((binding) => binding.importedName === 'AppSettings'))
            failures.push(dependencyDiagnostic(file, edge, 'app log service must consume app log types'));
        }
      }
    }
    return failures;
  },
};
