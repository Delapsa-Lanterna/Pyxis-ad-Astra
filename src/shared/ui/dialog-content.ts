import { h, type Ref, type VNodeChild } from 'vue';
import { NSelect } from 'naive-ui/es/select';
import { NCollapse, NCollapseItem } from 'naive-ui/es/collapse';

export function dialogBody(...paragraphs: VNodeChild[]) {
  return h(
    'div',
    { class: 'dialog-body' },
    paragraphs.map((value) => (typeof value === 'string' ? h('p', value) : value)),
  );
}
export function dialogFiles(paths: readonly string[]) {
  return h(
    'ul',
    { class: 'dialog-files' },
    paths.map((path) => h('li', h('code', path))),
  );
}
export function dialogGroup(title: string, ...paragraphs: VNodeChild[]) {
  return h('section', { class: 'dialog-group' }, [h('strong', title), dialogBody(...paragraphs)]);
}
export function dialogSelect<T extends string>(label: string, value: Ref<T>, options: { label: string; value: T }[]) {
  return dialogBody(
    label,
    h(NSelect, { value: value.value, options, 'aria-label': label, 'onUpdate:value': (next: T) => (value.value = next) }),
  );
}
export function dialogDisclosure(title: string, ...content: VNodeChild[]) {
  return h(NCollapse, null, { default: () => h(NCollapseItem, { title, name: title }, { default: () => dialogBody(...content) }) });
}
