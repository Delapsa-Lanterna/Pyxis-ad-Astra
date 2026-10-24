<template>
  <div class="n-collapse-item" :class="{ 'n-collapse-item--active': expanded }">
    <div class="n-collapse-item__header ui-control-row">
      <div class="n-collapse-item__header-main ui-control-pointer" @click="collapse.toggle(name)">
        <slot name="header" :collapsed="!expanded">
          <component v-if="collapse.slots.header" :is="collapse.slots.header" :collapsed="!expanded" />
          <template v-else>{{ title }}</template>
        </slot>
        <div class="n-collapse-item-arrow">
          <slot name="arrow" :collapsed="!expanded">
            <component v-if="collapse.slots.arrow" :is="collapse.slots.arrow" :collapsed="!expanded" />
            <svg v-else class="section-chevron-icon ui-control-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </slot>
        </div>
      </div>
      <div
        v-if="$slots['header-extra'] || collapse.slots['header-extra']"
        class="n-collapse-item__header-extra ui-control-row"
        @click="collapse.toggle(name)"
      >
        <slot name="header-extra" :collapsed="!expanded">
          <component :is="collapse.slots['header-extra']" :collapsed="!expanded" />
        </slot>
      </div>
    </div>
    <Transition
      name="editor-collapse"
      @before-leave="beginEditorCollapseLeave"
      @after-leave="finishEditorCollapseLeave"
      @leave-cancelled="finishEditorCollapseLeave"
    >
      <div v-if="mounted" v-show="expanded" ref="content" class="n-collapse-item__content-wrapper">
        <div class="n-collapse-item__content-inner"><slot /></div>
      </div>
    </Transition>
  </div>
</template>
<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { beginEditorCollapseLeave, editorCollapseKey, finishEditorCollapseLeave } from './editor-collapse';
const props = defineProps<{ name: string | number; title?: string }>();
const collapse = inject(editorCollapseKey)!;
const expanded = computed(() => collapse.expanded.value.includes(props.name));
const mounted = ref(expanded.value);
const content = ref<HTMLElement | null>(null);
watch(expanded, (open) => {
  if (open) mounted.value = true;
});
onBeforeUnmount(() => {
  if (content.value) finishEditorCollapseLeave(content.value);
});
</script>
