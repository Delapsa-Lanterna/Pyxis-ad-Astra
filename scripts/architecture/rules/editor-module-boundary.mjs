import { classifyFrontendPath } from '../../shared/classify.mjs';
import { frontendFile, specFile } from '../../shared/files.mjs';

/** @type {ReadonlySet<string | null>} */
const specImplementations = new Set([
  'spec-editor-assembly',
  'spec-editor-draft-images',
  'spec-ship-editor',
  'spec-weapon-editor',
  'spec-projectile-editor',
  'spec-system-editor',
]);

export const editorModuleBoundaryRule = {
  name: 'editor-module-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel) || specFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      if (current.layer !== 'test' && current.layer === 'app') {
        if (current.domain !== 'engine-renderer' && /['"]engine(?:Glow|Flame|HitGlow)['"]/.test(file.text))
          failures.push(`${file.rel}: engine effects must delegate layer drawing to the engine renderer`);
        if (current.domain !== 'engine-renderer' && /\.engineColor\b|\[['"]engineColor['"]\]/.test(file.text))
          failures.push(`${file.rel}: engine colors must be resolved by the engine renderer`);
        if (
          current.domain !== 'engine-renderer' &&
          /['"](?:rgb\(|engine-source-atop|engine-fallback)['"]/.test(file.text) &&
          /engine/i.test(file.text)
        )
          failures.push(`${file.rel}: engine tint products must belong to the engine rendering runtime`);
      }
      if (!isEditorSurface(current)) continue;
      if (/\bqueryCsvTableWindow\s*\(/.test(file.text)) {
        failures.push(`${file.rel}: editor candidates must use source/entity query, not CSV windows`);
      }
      if (current.domain === 'spec-editor-window-view-model') {
        for (const dependency of file.dependencies) {
          const target = classifyFrontendPath(dependency.resolved);
          if (specImplementations.has(target.domain) || (target.layer === 'app' && target.role === 'component'))
            failures.push(file.rel + ': shared spec session must consume injected editor definitions');
        }
      }
    }
    for (const file of files) {
      const current = classifyFrontendPath(file.rel);
      if (
        current.layer === 'services' &&
        (current.domain === 'spec-weapon-editor' || current.domain === 'weapon-data') &&
        /querySessionEntity\([^,]+,\s*['"]projectile['"]/.test(file.text)
      )
        failures.push(file.rel + ': projectile details belong to their consuming editor or fire preview');
    }
    return failures;
  },
};

/** @param {import('../../shared/classify.mjs').FrontendPathClass} current @returns {boolean} */
function isEditorSurface(current) {
  return current.layer === 'app' && (current.domain === 'spec-editor' || current.domain === 'spec-editor-window-view-model');
}
