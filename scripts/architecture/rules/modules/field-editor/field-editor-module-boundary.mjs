import { defineRule } from '../../../diagnostics.mjs';

export const fieldEditorModuleBoundaryRule = defineRule(
  'field-editor-module-boundary',
  '.zcode/modules/field-editor.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const component = file.role.layer === 'app' && file.role.role === 'component' && file.role.domain === 'field-editor';
      const dispatch = component && file.frontend.conditions.find((condition) => /\b(?:field|active)\.type\b/.test(condition.expression));
      if (
        dispatch &&
        !file.frontend.conditions.some((condition) => /\b(?:plainMode|mode|settings\.isPlainEditMode)\b/.test(condition.expression))
      )
        report(file, dispatch, 'field rendering must cover plain text and enhanced edit modes');
      if (file.role.layer === 'shared' && file.role.domain === 'types')
        for (const declaration of file.frontend.declarations)
          if (declaration.name === 'FieldEditorContext')
            report(file, declaration, 'FieldEditorContext belongs to field editor domain', {
              symbol: declaration.name,
              expected: 'field editor domain',
            });
      if (component)
        for (const token of [
          'querySourceOptions',
          'subscribeSourceOptionInvalidation',
          'sourceOptionsRequestId',
          'pickFileDialog',
          'pathBelongsToRoot',
          'relativePathFromRoot',
          'resolveSource',
        ]) {
          const position = file.frontend.identifiers.get(token);
          if (position)
            report(file, position, 'field renderer must delegate source and path behavior to field editor composables', {
              symbol: token,
              expected: 'field editor composables',
            });
        }
    }
  },
);
