<template>
  <n-popover
    v-if="text"
    v-bind="point"
    class="window-tooltip"
    trigger="manual"
    raw
    :show="show"
    :show-arrow="false"
    :theme-overrides="{ fontSize: '11px' }"
    placement="bottom-start"
  >
    <span role="tooltip">{{ text }}</span>
  </n-popover>
</template>
<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue';
import { useWindowCloseState } from '@/app/composables/use-window-close-state';

const closing = useWindowCloseState();
const text = ref(''),
  show = ref(false);
const point = ref({ x: 0, y: 0 });
let anchor: Element | null = null;
let timer: ReturnType<typeof setTimeout>;
const observer = new MutationObserver(() => {
  const title = anchor!.getAttribute('title');
  observer.disconnect();
  if (title) {
    text.value = title;
    suppressTitle();
  } else {
    anchor = null;
    close();
  }
});
function dismiss() {
  clearTimeout(timer);
  show.value = false;
}
function close() {
  dismiss();
  observer.disconnect();
  if (anchor?.getAttribute('title') === '') anchor.setAttribute('title', text.value);
  anchor = null;
  text.value = '';
}
function suppressTitle() {
  anchor!.setAttribute('title', '');
  observer.observe(anchor!, { attributes: true, attributeFilter: ['title'] });
}
function open(event: MouseEvent) {
  const target = (event.target as Element).closest('[title]');
  if (target === anchor) return;
  close();
  if (closing?.value || !target?.getAttribute('title') || target.closest('[inert]')) return;
  anchor = target;
  text.value = target.getAttribute('title')!;
  suppressTitle();
  point.value = { x: event.clientX, y: event.clientY + 16 };
  timer = setTimeout(() => {
    if (anchor!.isConnected) show.value = true;
    else close();
  }, 400);
}
function leave(event: MouseEvent) {
  if (!(event.relatedTarget instanceof Node) || !anchor?.contains(event.relatedTarget)) close();
}
watch(() => closing?.value, close);
const listeners = new window.AbortController();
const options = { capture: true, signal: listeners.signal };
document.addEventListener('mouseover', open, options);
document.addEventListener('mouseout', leave, options);
for (const event of ['pointerdown', 'input', 'scroll'] as const) document.addEventListener(event, dismiss, options);
for (const event of ['resize', 'blur'] as const) window.addEventListener(event, dismiss, options);
onScopeDispose(close);
onScopeDispose(() => listeners.abort());
</script>
