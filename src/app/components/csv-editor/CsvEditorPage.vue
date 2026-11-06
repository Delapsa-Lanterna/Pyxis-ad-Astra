<template>
  <section class="csv-editor-page ui-content-fill ui-content-contained ui-layout-grid ui-layout-stretch">
    <header class="topbar page-header ui-content-surface">
      <div class="view-heading page-identity">
        <h1 class="view-title page-title ui-text-truncate">{{ MODULE_LABELS[view.currentTab] }}</h1>
        <div class="view-meta page-description">{{ view.tableInfo }}</div>
      </div>
      <div class="top-actions action-group">
        <div class="top-action-group action-group">
          <n-input
            :value="view.searchText"
            :disabled="searchDisabled"
            class="top-search-input"
            clearable
            :placeholder="csvSearchPlaceholder(view.searchField)"
            @update:value="csvTable.setSearchText"
          >
            <template #suffix>
              <n-dropdown
                :key="csvTable.targetKey.value"
                trigger="click"
                :disabled="searchDisabled"
                :value="view.searchField"
                :options="searchOptions"
                :render-icon="searchIcon"
                @select="csvTable.setSearchField"
              >
                <n-button
                  text
                  size="tiny"
                  :disabled="searchDisabled"
                  :title="csvSearchPlaceholder(view.searchField)"
                  aria-label="选择搜索项"
                >
                  <svg class="ui-control-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </n-button>
              </n-dropdown>
            </template>
          </n-input>
        </div>
        <div class="top-action-group action-group">
          <n-button :disabled="view.currentTableLocked || !model.state.value" @click="actions.addNewRow">新建</n-button>
          <n-button type="error" ghost :disabled="view.currentTableLocked || !view.selectedRowKey" @click="deleteRows">删除</n-button>
        </div>
        <div class="top-action-group action-group">
          <n-button :disabled="view.currentTableLocked || !model.document.value?.canUndo.value" @click="actions.undoCurrentTableEdit"
            >撤销</n-button
          >
          <n-button :disabled="view.currentTableLocked || !model.document.value?.canRedo.value" @click="actions.redoCurrentTableEdit"
            >重做</n-button
          >
          <n-button
            type="primary"
            :loading="view.saving"
            :disabled="view.currentTableLocked || !view.canSaveCurrentTable"
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
        <CsvTableEditor
          ref="tableEditor"
          :key="csvTable.targetKey.value"
          :csv-table="csvTable"
          @undo="actions.undoCurrentTableEdit"
          @redo="actions.redoCurrentTableEdit"
        />
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
      <aside
        id="csv-detail-panel"
        v-show="detailPaneExpanded"
        class="csv-detail-panel ui-content-column ui-content-contained ui-content-surface-muted"
      >
        <EditorProblems :issues="problems.issues.value" @locate="locateProblem" />
        <CsvRowDetails
          :model="model"
          :starsector-root="host.starsectorRoot.value"
          :query-row-preview="csvTable.querySelectedRowPreview"
          :source-index="csvTable.sourceIndex.value"
          @detail-action="actions.handleDetailAction"
        />
      </aside>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, h, useTemplateRef, watch } from 'vue';
import { NDropdown } from 'naive-ui/es/dropdown';
import CsvTableEditor from '@/app/components/csv-editor/CsvTableEditor.vue';
import EditorProblems from '@/shared/ui/EditorProblems.vue';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import CsvRowDetails from '@/app/components/csv-editor/CsvRowDetails.vue';
import { useCsvTableViewModel } from '@/app/composables/csv-editor/use-csv-table-view-model';
import { useCsvEditorActions } from '@/app/composables/csv-editor/use-csv-editor-actions';
import { useCsvEditorModel } from '@/app/composables/csv-editor/use-csv-editor-model';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { CsvEditorHost } from '@/app/composables/csv-editor/csv-editor-context';
import type { FieldProblem, CsvTableTarget } from '@/shared/types';
import { MODULE_LABELS } from '@/shared/lib/starsector';
import { csvSearchOptions, csvSearchPlaceholder } from '@/domain/csv-editor/csv-search';

const props = defineProps<{ target: CsvTableTarget; host: CsvEditorHost }>();
const host = props.host;
const model = useCsvEditorModel(computed(() => props.target));
const view = model.view;
const problems = useCsvEditorStore().getTableProblems(props.target);
const actions = useCsvEditorActions(model, host, useAppFeedback());
const detailPaneExpanded = defineModel<boolean>('detailPaneExpanded', { default: true });
watch(problems.revealRevision, () => {
  detailPaneExpanded.value = true;
});
const tableEditor = useTemplateRef<InstanceType<typeof CsvTableEditor>>('tableEditor');
async function deleteRows() {
  if (!(await tableEditor.value!.deleteRows())) await actions.deleteSelectedRow();
}
const csvTable = useCsvTableViewModel(model, host);

async function locateProblem(issue: FieldProblem) {
  const target = await csvTable.locateProblem(issue);
  if (target) tableEditor.value!.locate(target.rowKey, target.column);
}
const searchDisabled = computed(() => view.currentTableLocked || csvTable.searchPending.value);
const searchOptions = computed(() =>
  csvSearchOptions(view.currentTab, view.currentHeader).map((option) => ({
    ...option,
    key: option.value,
    disabled: searchDisabled.value,
  })),
);
const searchIcon = (option: { key?: string | number }) =>
  option.key === view.searchField
    ? h(
        'svg',
        { class: 'ui-control-icon', width: 16, height: 16, viewBox: '0 0 24 24', 'aria-hidden': true },
        h('path', { d: 'm5 12 4 4L19 6' }),
      )
    : null;
</script>
