<template>
  <section class="workspace ui-content-fill ui-content-contained ui-layout-grid ui-layout-stretch">
    <header class="topbar page-header ui-content-surface">
      <div class="view-heading page-identity">
        <h1 class="view-title page-title ui-text-truncate">{{ MODULE_LABELS[tables.currentTab] }}</h1>
        <div class="view-meta page-description">{{ tables.tableInfo }}</div>
      </div>
      <div class="top-actions action-group">
        <div class="top-action-group action-group">
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
        <div class="top-action-group action-group">
          <n-button :disabled="tables.currentTableLocked || !workspace.activeManifest" @click="actions.addNewRow">新建</n-button>
          <n-button type="error" ghost :disabled="tables.currentTableLocked || !tables.selectedRowKey" @click="actions.deleteSelectedRow"
            >删除</n-button
          >
        </div>
        <div class="top-action-group action-group">
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
      :class="{ 'workspace-sidebar-collapsed': !sidebarExpanded }"
    >
      <div class="table-content ui-content-column ui-content-contained">
        <DataTable :key="csvTable.targetKey.value" :csv-table="csvTable" />
      </div>
      <button
        class="workspace-sidebar-toggle ui-button ui-control-button ui-control-reset"
        type="button"
        :title="sidebarExpanded ? '收起侧边栏' : '展开侧边栏'"
        :aria-label="sidebarExpanded ? '收起侧边栏' : '展开侧边栏'"
        :aria-expanded="sidebarExpanded"
        aria-controls="csv-sidebar-panel"
        @click="sidebarExpanded = !sidebarExpanded"
      />
      <DetailPane
        id="csv-sidebar-panel"
        v-show="sidebarExpanded"
        :query-row-preview="csvTable.querySelectedRowPreview"
        :source-index="csvTable.sourceIndex.value"
        @detail-action="actions.handleDetailAction"
      />
    </section>
  </section>
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
const sidebarExpanded = defineModel<boolean>('sidebarExpanded', { default: true });
const workspace = useWorkspaceStore();
const csvTable = useCsvTableViewModel();
const actions = useWorkspaceShellActions(useAppFeedback());

const searchOptions = computed(() => csvSearchOptions(tables.currentTab, tables.currentHeader));
</script>
