import { defineRule } from '../../../diagnostics.mjs';

const savedEvents = new Set(['EditorSpecSavedEvent', 'FileEditorSavedEvent']);

export const windowBoundaryRule = defineRule(
  'window-boundary',
  '.zcode/modules/app-windowing.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend)
      for (const declaration of file.frontend.declarations) {
        if (
          declaration.exported &&
          savedEvents.has(declaration.name) &&
          (!declaration.properties.includes('writeResult') ||
            !declaration.propertyTypes.get('writeResult')?.some((type) => type === 'WriteResult' || type.endsWith('.WriteResult')))
        )
          report(file, declaration, 'window save events must carry WriteResult', {
            symbol: declaration.name,
            expected: 'writeResult: WriteResult',
          });
        if (declaration.exported && savedEvents.has(declaration.name) && declaration.properties.includes('changes'))
          report(file, declaration, 'window save events must not carry raw changes', {
            symbol: declaration.name,
            expected: 'WriteResult.changes',
          });
      }
  },
);
