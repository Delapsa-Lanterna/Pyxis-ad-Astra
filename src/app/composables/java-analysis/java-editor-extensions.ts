import { Decoration, EditorView, hoverTooltip, keymap } from '@codemirror/view';
import { displayOffset } from '@/shared/runtime/text-document';
import type { JavaEditorFile } from './java-editor-files';
import type { JavaInspection, JavaQueryPurpose } from '@/shared/types';

export function javaEditorExtensions({
  document,
  result,
  inspect,
  navigate,
  signature,
  fail,
}: {
  document: JavaEditorFile | null;
  result: JavaInspection | undefined;
  inspect: (purpose: JavaQueryPurpose, position?: number) => Promise<JavaInspection | null>;
  navigate: (purpose: 'declaration' | 'references', position?: number) => Promise<void>;
  signature: (result: JavaInspection) => string;
  fail: (error: unknown) => void;
}) {
  return [
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || view.composing) return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null || !view.state.wordAt(position)) return false;
        void navigate('declaration', position).catch(fail);
        return true;
      },
    }),
    keymap.of([
      {
        key: 'F12',
        run: () => {
          void navigate('declaration').catch(fail);
          return true;
        },
      },
      {
        key: 'Shift-F12',
        run: () => {
          void navigate('references').catch(fail);
          return true;
        },
      },
    ]),
    hoverTooltip(async (_view, position) => {
      const result = await inspect('hover', position);
      return result?.binding
        ? {
            pos: position,
            create() {
              const dom = window.document.createElement('div');
              dom.textContent = signature(result);
              return { dom };
            },
          }
        : null;
    }),
    EditorView.decorations.of(
      Decoration.set(
        document && result
          ? result.diagnostics
              .map((diagnostic) => {
                const from = displayOffset(document.document.content.value, diagnostic.start),
                  to = displayOffset(document.document.content.value, diagnostic.end);
                return to > from
                  ? Decoration.mark({ class: `code-diagnostic-${diagnostic.severity}`, attributes: { title: diagnostic.message } }).range(
                      from,
                      to,
                    )
                  : null;
              })
              .filter((range) => range !== null)
              .sort((a, b) => a.from - b.from)
          : [],
      ),
    ),
  ];
}
