<template>
  <section class="file-history-page page-content">
    <header class="file-history-header page-header">
      <div class="page-identity">
        <h1 class="page-title">文件历史</h1>
        <p class="file-history-header-description page-description">
          {{ modTitle }}
        </p>
      </div>
      <n-button type="error" ghost :disabled="historyCount === 0" @click="confirmClear">清空文件历史</n-button>
    </header>

    <div class="file-history-summary ui-layout-row ui-control-border ui-content-surface">
      <div class="file-history-summary-content panel-card ui-control-center ui-layout-stack ui-control-border ui-content-surface">
        <span class="file-history-summary-label ui-text-muted ui-text-small">可撤销</span>
        <strong class="file-history-summary-value ui-emphasis ui-text-normal">{{ undoStack.length }}</strong>
      </div>
      <div class="file-history-summary-content panel-card ui-control-center ui-layout-stack ui-control-border ui-content-surface">
        <span class="file-history-summary-label ui-text-muted ui-text-small">可重做</span>
        <strong class="file-history-summary-value ui-emphasis ui-text-normal">{{ redoStack.length }}</strong>
      </div>
      <div class="file-history-summary-content panel-card ui-control-center ui-layout-stack ui-control-border ui-content-surface">
        <span class="file-history-summary-label ui-text-muted ui-text-small">总计</span>
        <strong class="file-history-summary-value ui-emphasis ui-text-normal">{{ historyCount }}</strong>
      </div>
    </div>

    <div class="file-history-stacks ui-layout-grid">
      <section class="file-history-panel ui-layout-shrink ui-control-border ui-content-surface ui-content-column ui-layout-clip">
        <header class="file-history-panel-heading ui-control-between">
          <h2 class="file-history-panel-title ui-text-soft ui-text-reset ui-text-small ui-text-normal">可撤销</h2>
          <n-button size="small" :disabled="!canUndo" @click="undoOne">撤销</n-button>
        </header>
        <p v-if="undoStack.length === 0" class="file-history-empty ui-text-muted ui-text-small ui-text-reset">没有可撤销的文件保存历史。</p>
        <div v-else class="file-history-entry-list ui-layout-grid">
          <article v-for="(item, index) in undoDisplayItems" :key="item.id" class="file-history-entry ui-layout-grid ui-layout-shrink">
            <div class="file-history-entry-main ui-text-small ui-layout-row ui-layout-center ui-layout-shrink">
              <span class="file-history-entry-index file-history-entry-main-label ui-text-truncate ui-text-muted ui-layout-shrink"
                >#{{ index + 1 }}</span
              >
              <div class="file-history-entry-main-content ui-layout-grid ui-layout-shrink">
                <strong class="file-history-entry-main-value ui-emphasis ui-text-truncate ui-layout-shrink ui-text-normal ui-text-small">{{
                  item.label
                }}</strong>
                <span class="file-history-entry-main-label ui-text-truncate ui-text-muted ui-layout-shrink">{{
                  formatTimestamp(item.timestamp)
                }}</span>
              </div>
              <em class="file-history-entry-main-note ui-text-muted">{{ formatItemKind(item) }}</em>
            </div>
            <ul class="file-history-change-list ui-text-path ui-text-muted ui-text-wrap ui-layout-grid ui-text-reset ui-control-reset">
              <li
                class="file-history-change-list-item ui-text-muted ui-layout-grid ui-layout-shrink"
                v-for="path in item.paths"
                :key="path"
              >
                <code class="file-history-change-list-key ui-code ui-text-truncate ui-text-soft ui-layout-shrink">{{ path }}</code>
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section class="file-history-panel ui-layout-shrink ui-control-border ui-content-surface ui-content-column ui-layout-clip">
        <header class="file-history-panel-heading ui-control-between">
          <h2 class="file-history-panel-title ui-text-soft ui-text-reset ui-text-small ui-text-normal">可重做</h2>
          <n-button size="small" :disabled="!canRedo" @click="redoOne">重做</n-button>
        </header>
        <p v-if="redoStack.length === 0" class="file-history-empty ui-text-muted ui-text-small ui-text-reset">没有可重做的文件保存历史。</p>
        <div v-else class="file-history-entry-list ui-layout-grid">
          <article v-for="(item, index) in redoDisplayItems" :key="item.id" class="file-history-entry ui-layout-grid ui-layout-shrink">
            <div class="file-history-entry-main ui-text-small ui-layout-row ui-layout-center ui-layout-shrink">
              <span class="file-history-entry-index file-history-entry-main-label ui-text-truncate ui-text-muted ui-layout-shrink"
                >#{{ index + 1 }}</span
              >
              <div class="file-history-entry-main-content ui-layout-grid ui-layout-shrink">
                <strong class="file-history-entry-main-value ui-emphasis ui-text-truncate ui-layout-shrink ui-text-normal ui-text-small">{{
                  item.label
                }}</strong>
                <span class="file-history-entry-main-label ui-text-truncate ui-text-muted ui-layout-shrink">{{
                  formatTimestamp(item.timestamp)
                }}</span>
              </div>
              <em class="file-history-entry-main-note ui-text-muted">{{ formatItemKind(item) }}</em>
            </div>
            <ul class="file-history-change-list ui-text-path ui-text-muted ui-text-wrap ui-layout-grid ui-text-reset ui-control-reset">
              <li
                class="file-history-change-list-item ui-text-muted ui-layout-grid ui-layout-shrink"
                v-for="path in item.paths"
                :key="path"
              >
                <code class="file-history-change-list-key ui-code ui-text-truncate ui-text-soft ui-layout-shrink">{{ path }}</code>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useFileHistoryViewModel } from '@/app/composables/editors/use-file-history-view-model';
import type { FileHistoryEntrySummary } from '@/shared/types';

const {
  modTitle,
  undoStack,
  redoStack,
  undoDisplayItems,
  redoDisplayItems,
  historyCount,
  canUndo,
  canRedo,
  confirmClear,
  undoOne,
  redoOne,
} = useFileHistoryViewModel();

function formatItemKind(item: FileHistoryEntrySummary): string {
  return `${item.paths.length} 个文件变更`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
</script>
