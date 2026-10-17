<template>
  <main class="workspace page-slot ui-content-fill ui-content-contained ui-layout-grid ui-layout-stretch">
    <header class="topbar page-header ui-control-between ui-layout-row ui-content-surface ui-layout-center">
      <div class="view-heading page-identity ui-layout-grid ui-layout-shrink">
        <h1 class="view-title page-title ui-text-truncate ui-text-reset ui-text-normal">{{ MODULE_LABELS[tables.currentTab] }}</h1>
        <div class="view-meta page-description ui-text-description ui-text-muted ui-text-reset ui-text-small">{{ tables.tableInfo }}</div>
      </div>
      <div class="top-actions ui-control-row">
        <div class="top-action-group ui-control-row ui-layout-row ui-layout-center">
          <n-input
            :value="tables.searchText"
            :disabled="tables.currentTableLocked"
            class="top-search-input"
            clearable
            :placeholder="csvSearchPlaceholder(tables.searchField)"
            @update:value="csvTable.setSearchText"
          />
          <n-select
            :value="tables.searchField"
            :disabled="tables.currentTableLocked"
            @update:value="csvTable.setSearchField"
            class="top-search-field-select"
            :options="searchOptions"
            placeholder="搜索项"
          />
        </div>
        <div class="top-action-group ui-control-row ui-layout-row ui-layout-center">
          <n-button :disabled="tables.currentTableLocked || !workspace.activeManifest" @click="actions.addNewRow">新建</n-button>
          <n-button type="error" ghost :disabled="tables.currentTableLocked || !tables.selectedRowKey" @click="actions.deleteSelectedRow"
            >删除</n-button
          >
        </div>
        <div class="top-action-group ui-control-row ui-layout-row ui-layout-center">
          <n-button :disabled="tables.currentTableLocked || !tables.canUndoCurrentTableEdit" @click="actions.undoCurrentTableEdit"
            >撤销</n-button
          >
          <n-button :disabled="tables.currentTableLocked || !tables.canRedoCurrentTableEdit" @click="actions.redoCurrentTableEdit"
            >重做</n-button
          >
          <n-button
            type="primary"
            :loading="tables.saving"
            :disabled="tables.currentTableLocked || !tables.hasCurrentTableChanges"
            @pointerdown.prevent="actions.saveChanges()"
            @click.prevent
          >
            保存
          </n-button>
        </div>
      </div>
    </header>
    <section
      class="content-grid ui-content-contained ui-layout-grid ui-layout-stretch"
      :class="{ 'workspace-context-collapsed': !contextExpanded }"
    >
      <div class="table-content ui-content-column ui-content-contained">
        <DataTable :key="csvTable.targetKey.value" :csv-table="csvTable" />
      </div>
      <button
        class="workspace-context-toggle ui-button ui-control-button ui-control-center ui-control-reset ui-text-muted"
        type="button"
        :title="contextExpanded ? '收起上下文' : '展开上下文'"
        :aria-label="contextExpanded ? '收起上下文' : '展开上下文'"
        :aria-expanded="contextExpanded"
        aria-controls="csv-context-panel"
        @click="contextExpanded = !contextExpanded"
      >
        <svg
          class="workspace-context-toggle-icon ui-control-icon"
          width="10"
          height="10"
          viewBox="0 0 16 16"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path :d="contextExpanded ? 'm6 4 4 4-4 4' : 'm10 4-4 4 4 4'" />
        </svg>
      </button>
      <DetailPane
        id="csv-context-panel"
        v-show="contextExpanded"
        :query-row-preview="csvTable.querySelectedRowPreview"
        :source-index="csvTable.sourceIndex.value"
        @detail-action="actions.handleDetailAction"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import DataTable from '@/app/components/tables/DataTable.vue';
import DetailPane from '@/app/components/tables/DetailPane.vue';
import { useCsvTableViewModel } from '@/app/composables/tables/use-csv-table-view-model';
import { useWorkspaceShellActions } from '@/app/composables/use-workspace-shell-actions';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { MODULE_LABELS } from '@/shared/lib/starsector';
import { csvSearchOptions, csvSearchPlaceholder } from '@/domain/tables/csv-search';

const tables = useTablesStore();
const contextExpanded = defineModel<boolean>('contextExpanded', { default: true });
const workspace = useWorkspaceStore();
const csvTable = useCsvTableViewModel();
const actions = useWorkspaceShellActions(useAppFeedback());

const searchOptions = computed(() => csvSearchOptions(tables.currentTab, tables.currentHeader));
</script>
