<template>
  <component :is="group.label ? 'NCollapseItem' : 'div'" class="csv-cell-picker-group" :name="group.key" :title="group.label">
    <button
      v-for="option in group.options"
      :key="option.value"
      v-memo="[
        option,
        selected.has(option.value),
        multiple,
        sessionId,
        media.mediaSrc(option.resourceRef),
        media.mediaVisible(option.value),
      ]"
      :ref="media.mediaRef(option.value, option.resourceRef)"
      class="csv-cell-picker-option ui-button ui-text-normal ui-text-small ui-layout-row ui-layout-center ui-layout-stretch"
      :class="{ selected: selected.has(option.value) }"
      :aria-pressed="multiple ? selected.has(option.value) : undefined"
      :title="option.description ?? undefined"
      type="button"
      @click="emit('select', option)"
    >
      <svg v-if="multiple" class="csv-cell-picker-check ui-control-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path v-if="selected.has(option.value)" d="m3 8 3 3 7-6" />
      </svg>
      <ResourceThumbnail
        v-if="option.resourceRef"
        class="csv-cell-picker-thumb"
        :session-id="sessionId"
        :resource="option.resourceRef"
        :url="media.mediaSrc(option.resourceRef)"
        :active="media.mediaVisible(option.value)"
        :label="option.label"
        :width="18"
        :height="18"
      />
      <span class="csv-cell-picker-label ui-text-truncate ui-layout-shrink">{{ option.label }}</span>
      <span v-if="option.value !== option.label" class="csv-cell-picker-value ui-text-truncate ui-layout-shrink ui-text-muted">{{
        option.value
      }}</span>
    </button>
  </component>
</template>
<script setup lang="ts">
import type { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';
import type { FlatSelectOption, SelectOptionGroup } from '@/domain/schema/schema-options';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';
defineProps<{
  group: SelectOptionGroup;
  selected: ReadonlySet<string>;
  multiple: boolean;
  sessionId: string;
  media: ReturnType<typeof useVisibleResourceMedia>;
}>();
const emit = defineEmits<{ select: [option: FlatSelectOption] }>();
</script>
