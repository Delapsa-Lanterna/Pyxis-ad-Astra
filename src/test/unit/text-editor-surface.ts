import { defineComponent, h, type PropType } from 'vue';
import type { TextDocument } from '@/shared/runtime/text-document';

export const textEditorSurface = defineComponent({
  props: { document: { type: Object as PropType<TextDocument>, required: true }, line: { type: Number, default: undefined } },
  setup(props, { expose }) {
    expose({ focus() {}, search() {}, locate: (line: number, column: number) => props.document.locate(line, column) });
    return () => h('div');
  },
});
