import { h } from 'vue';
import type { TreeOption, TreeProps } from 'naive-ui/es/tree';
import type { FileDirectoryState } from '@/shared/types';

export const fileTreePrefix: NonNullable<TreeProps['renderPrefix']> = ({ option }) =>
  option.kind === 'status'
    ? null
    : h('svg', { class: 'file-browser-node-icon ui-control-icon', viewBox: '0 0 16 16', 'aria-hidden': true }, [
        h('path', {
          d:
            option.kind === 'directory'
              ? 'M2 4h4l2 2h6v6H2z'
              : option.kind === 'restricted'
                ? 'M5 7V5a3 3 0 0 1 6 0v2M4 7h8v7H4zM8 10v1.5'
                : 'M9 2H4v12h8V5zM9 2v3h3',
        }),
      ]);
export function fileTreeLabel(option: TreeOption, status: FileDirectoryState | undefined, retry: () => void) {
  return h('span', { class: 'file-browser-name' }, [
    h(
      'span',
      { class: { 'file-browser-name-text': true, 'file-browser-match': option.matched }, title: String(option.label) },
      String(option.label),
    ),
    status?.loading ? h('span', { class: 'file-browser-node-status' }, '读取中…') : null,
    status?.error
      ? h(
          'button',
          {
            type: 'button',
            class: 'file-browser-retry',
            title: status.error,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              retry();
            },
            onDblclick: (event: MouseEvent) => event.stopPropagation(),
          },
          '读取失败，重试',
        )
      : null,
  ]);
}
