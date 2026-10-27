<template>
  <aside ref="listElement" class="json-entity-list ui-layout-row ui-layout-stack ui-layout-clip ui-content-surface-muted">
    <header class="json-entity-list-header">
      <h3 class="json-entity-list-header-title ui-text-reset">{{ definition.label }}</h3>
      <small class="json-entity-list-count">{{ items.length }} 项</small>
    </header>
    <ul :ref="setMediaRoot" class="json-entity-list-items ui-text-reset">
      <li v-if="!items.length" class="json-entity-list-empty ui-text-small">
        {{ loadFailed ? '读取失败，请通过错误提示修复文件后刷新。' : '未找到 ' + definition.directory + ' 下的' + definition.label + '。' }}
      </li>
      <li
        v-for="item in items"
        :key="item.key"
        :data-entity-id="item.key"
        :ref="mediaRef(item.key, item.resource)"
        class="json-entity-list-item ui-text-soft ui-layout-shrink ui-control-pointer ui-layout-grid ui-layout-center"
        :class="{ active: item.key === selectedId, dirty: item.dirty }"
        @click="emit('select', item.key)"
      >
        <span v-if="item.resource" class="json-entity-thumb ui-layout-grid ui-layout-clip ui-control-border"
          ><ResourceThumbnail
            :session-id="sessionId"
            :resource="item.resource"
            :url="mediaSrc(item.resource)"
            :active="mediaVisible(item.key)"
            :label="item.title"
            :width="20"
            :height="20"
        /></span>
        <span v-else-if="item.color" class="json-entity-color ui-control-border" :style="{ backgroundColor: item.color }" />
        <svg v-else class="json-entity-icon ui-text-muted" viewBox="0 0 24 24" aria-hidden="true">
          <path v-for="icon in definition.file?.listIconPaths ?? [definition.icon]" :key="icon" :d="icon" />
        </svg>
        <span class="json-entity-text ui-layout-grid ui-layout-shrink"
          ><span class="json-entity-name json-entity-text-value ui-text-truncate ui-layout-shrink">{{ item.title }}</span
          ><small class="json-entity-text-meta ui-text-truncate ui-text-muted ui-layout-shrink"
            >{{ item.filename || item.id }}<span v-if="item.dirty"> · 未保存</span><span v-if="item.missing"> · 来源缺失</span
            ><span v-else-if="item.state === 'missing'"> · 未创建</span><span v-else-if="item.state === 'present'"> · 已创建</span
            ><span v-if="item.state === 'error'"> · 读取失败</span></small
          ></span
        >
      </li>
    </ul>
    <footer v-if="definition.kind !== 'misc-config'" class="json-entity-list-footer ui-footer">
      <n-button size="small" block :loading="opening || actionRunning" @click="openCreate">新建{{ definition.label }}</n-button>
    </footer>
    <n-modal
      v-model:show="showCreate"
      preset="dialog"
      :title="'新建' + definition.label"
      positive-text="创建"
      negative-text="取消"
      :positive-button-props="{ loading: actionRunning, disabled: actionRunning }"
      @positive-click="submitCreate"
    >
      <div class="ui-field-stack">
        <FieldRow v-if="definition.file" :label="definition.file.companionField"
          ><n-input v-if="settings.isPlainEditMode" v-model:value="newCompanion" :placeholder="definition.file.companionField" /><n-select
            v-else
            v-model:value="newCompanion"
            :options="hullOptions"
            filterable
            tag
            :placeholder="definition.file.companionField" /></FieldRow
        ><FieldRow :label="definition.idField"><n-input v-model:value="newId" :placeholder="definition.idField" autofocus /></FieldRow>
      </div>
    </n-modal>
  </aside>
</template>
<script setup lang="ts">
import { ref, watch, nextTick, useTemplateRef } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';
import type { useJsonEditorViewModel } from '@/app/composables/json-editor/use-json-editor-view-model';
import type { JsonDocumentDefinition } from '@/domain/json-editor/json-document-definitions';
import type { SelectOption } from '@/domain/schema/schema-options';
import FieldRow from '@/shared/ui/FieldRow.vue';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';
const props = defineProps<{
  definition: JsonDocumentDefinition;
  sessionId: string;
  selectedId: string | null;
  items: ReturnType<typeof useJsonEditorViewModel>['items']['value'];
  actionRunning: boolean;
  loadFailed?: boolean;
  hullOptions: SelectOption[];
  loadHullOptions: () => Promise<void>;
  create: (id: string, companion: string) => Promise<boolean>;
  listLoadStartedAt: number;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const settings = useSettingsStore();
const { mediaRef, mediaSrc, mediaVisible, recordListFirstFrame, setMediaRoot } = useVisibleResourceMedia({
  thumbnailSize: 20,
  sessionId: () => props.sessionId,
  surface: 'json-' + props.definition.kind + '-list',
  failureLabel: '读取' + props.definition.label + '缩略图失败',
});
const listElement = useTemplateRef<HTMLElement>('listElement');
watch(
  () => [props.selectedId, props.items] as const,
  async () => {
    await nextTick();
    const row = listElement.value?.querySelector<HTMLElement>('[data-entity-id="' + CSS.escape(props.selectedId ?? '') + '"]');
    if (row) {
      const list = row.parentElement!;
      list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    }
  },
  { immediate: true, flush: 'post' },
);
const showCreate = ref(false);
const opening = ref(false);
const newId = ref('');
const newCompanion = ref('');
async function openCreate() {
  opening.value = true;
  try {
    await props.loadHullOptions();
    newId.value = '';
    newCompanion.value = '';
    showCreate.value = true;
  } finally {
    opening.value = false;
  }
}
async function submitCreate() {
  if (!(await props.create(newId.value.trim(), newCompanion.value.trim()))) return false;
  showCreate.value = false;
  return true;
}
watch(
  () => props.items,
  (items) => {
    void recordListFirstFrame(props.listLoadStartedAt, items.length);
  },
);
</script>
