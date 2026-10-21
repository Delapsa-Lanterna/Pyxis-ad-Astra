<template>
  <section class="csv-editor-workspace ui-content-fill ui-content-contained ui-layout-grid ui-layout-stretch">
    <header class="topbar page-header ui-content-surface">
      <div class="view-heading page-identity">
        <h1 class="view-title page-title ui-text-truncate">{{ MODULE_LABELS[tables.currentTab] }}</h1>
        <div class="view-meta page-description">{{ tables.tableInfo }}</div>
      </div>
      <div class="top-actions action-group">
        <div class="top-action-group action-group">
          <n-input
            :value="tables.searchText"
            :disabled="tables.currentTableLocked || csvTable.searchPending.value"
            class="top-search-input"
            clearable
            :placeholder="csvSearchPlaceholder(tables.searchField)"
            @update:value="csvTable.setSearchText"
          />
          <n-select
            :value="tables.searchField"
            :disabled="tables.currentTableLocked || csvTable.searchPending.value"
            @update:value="csvTable.setSearchField"
            class="top-search-field-select"
            :options="searchOptions"
            placeholder="搜索项"
          />
        </div>
        <div class="top-action-group action-group">
          <n-button :disabled="tables.currentTableLocked || !workspace.activeManifest" @click="actions.addNewRow">新建</n-button>
          <n-button type="error" ghost :disabled="tables.currentTableLocked || !tables.selectedRowKey" @click="actions.deleteSelectedRow"
            >删除</n-button
          >
        </div>
        <div class="top-action-group action-group">
          <n-button :disabled="tables.currentTableLocked || !tables.activeEditor?.canUndo.value" @click="actions.undoCurrentTableEdit"
            >撤销</n-button
          >
          <n-button :disabled="tables.currentTableLocked || !tables.activeEditor?.canRedo.value" @click="actions.redoCurrentTableEdit"
            >重做</n-button
          >
          <n-button
            type="primary"
            :loading="tables.saving"
            :disabled="tables.currentTableLocked || !tables.canSaveCurrentTable"
            @pointerdown.prevent="actions.save()"
            @click.prevent
          >
            保存
          </n-button>
        </div>
      </div>
    </header>
    <section
      class="content-grid ui-content-contained ui-layout-grid ui-layout-stretch"
      :class="{ 'csv-details-collapsed': !detailPaneExpanded }"
    >
      <div class="table-content ui-content-column ui-content-contained">
        <CsvTableEditor :key="csvTable.targetKey.value" :csv-table="csvTable" />
      </div>
      <button
        class="csv-details-toggle ui-panel-toggle ui-button ui-control-button ui-control-reset"
        type="button"
        :title="detailPaneExpanded ? '收起详情栏' : '展开详情栏'"
        :aria-label="detailPaneExpanded ? '收起详情栏' : '展开详情栏'"
        :aria-expanded="detailPaneExpanded"
        aria-controls="csv-detail-panel"
        @click="detailPaneExpanded = !detailPaneExpanded"
      />
      <CsvRowDetails
        id="csv-detail-panel"
        v-show="detailPaneExpanded"
        :query-row-preview="csvTable.querySelectedRowPreview"
        :source-index="csvTable.sourceIndex.value"
        @detail-action="actions.handleDetailAction"
      />
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CsvTableEditor from '@/app/components/csv-editor/CsvTableEditor.vue';
import CsvRowDetails from '@/app/components/csv-editor/CsvRowDetails.vue';
import { useCsvTableViewModel } from '@/app/composables/csv-editor/use-csv-table-view-model';
import type { useCsvEditorActions } from '@/app/composables/csv-editor/use-csv-editor-actions';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { MODULE_LABELS } from '@/shared/lib/starsector';
import { csvSearchOptions, csvSearchPlaceholder } from '@/domain/csv-editor/csv-search';

const tables = useCsvEditorStore();
const detailPaneExpanded = defineModel<boolean>('detailPaneExpanded', { default: true });
const workspace = useWorkspaceStore();
const { actions } = defineProps<{ actions: ReturnType<typeof useCsvEditorActions> }>();
const csvTable = useCsvTableViewModel(async () => {
  const result = await actions.save();
  return result?.status === 'saved' || result?.status === 'noop';
});

const searchOptions = computed(() => csvSearchOptions(tables.currentTab, tables.currentHeader));
</script>
