<template>
  <section class="mod-overview-page page-content">
    <header class="mod-overview-header page-header">
      <div class="page-identity">
        <h1 class="page-title">{{ modName }}</h1>
        <p class="mod-overview-header-description page-description">{{ modVersion || '未声明版本' }}</p>
      </div>
    </header>
    <div class="mod-overview-grid ui-layout-grid">
      <article class="mod-overview-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid">
        <span class="mod-overview-card-label ui-text-description ui-text-reset ui-text-muted ui-text-small">数据表</span>
        <strong class="mod-overview-card-value ui-emphasis ui-text-truncate ui-text-wrap ui-text-normal ui-layout-shrink">{{
          tableTotal
        }}</strong>
        <p class="mod-overview-card-description ui-text-description ui-text-reset ui-text-muted ui-text-small">
          舰船、武器、联队、舰船插件、工业和技能记录
        </p>
      </article>
      <article class="mod-overview-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid">
        <span class="mod-overview-card-label ui-text-description ui-text-reset ui-text-muted ui-text-small">配置</span>
        <strong class="mod-overview-card-value ui-emphasis ui-text-truncate ui-text-wrap ui-text-normal ui-layout-shrink">{{
          configTotal
        }}</strong>
        <p class="mod-overview-card-description ui-text-description ui-text-reset ui-text-muted ui-text-small">势力与战役配置项</p>
      </article>
      <article class="mod-overview-card wide ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid">
        <span class="mod-overview-card-label ui-text-description ui-text-reset ui-text-muted ui-text-small">目录</span>
        <strong
          class="mod-overview-card-value wide-value ui-emphasis ui-text-truncate ui-text-wrap ui-text-body ui-text-normal ui-layout-shrink"
          >{{ overview.modRootText }}</strong
        >
        <p class="mod-overview-card-description ui-text-description ui-text-reset ui-text-muted ui-text-small">
          当前工作区会原位读写该 Mod 目录下的数据文件
        </p>
      </article>
      <article class="mod-overview-card wide ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid">
        <span class="mod-overview-card-label ui-text-description ui-text-reset ui-text-muted ui-text-small">原版资源</span>
        <strong
          class="mod-overview-card-value wide-value ui-emphasis ui-text-truncate ui-text-wrap ui-text-body ui-text-normal ui-layout-shrink"
          >{{ overview.coreAvailable ? '可用' : '不可用' }}</strong
        >
        <p class="mod-overview-card-description ui-text-description ui-text-reset ui-text-muted ui-text-small">{{ coreResourceText }}</p>
      </article>
    </div>
    <div class="mod-overview-breakdown ui-layout-clip ui-control-border ui-layout-grid ui-content-surface">
      <div
        v-for="item in breakdown"
        :key="item.label"
        class="mod-overview-breakdown-row ui-text-small ui-layout-row ui-text-soft ui-layout-center"
      >
        <span>{{ item.label }}</span
        ><strong class="mod-overview-breakdown-row-value ui-emphasis ui-text-muted">{{ item.count }}</strong>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { buildWorkspaceModOverview } from '@/domain/workspace/mod-overview';

const workspace = useWorkspaceStore();
const overview = computed(() => buildWorkspaceModOverview(workspace.activeManifest));
const modName = computed(() => overview.value.modName);
const modVersion = computed(() => overview.value.modVersion);
const coreResourceText = computed(() => overview.value.coreResourceText);
const breakdown = computed(() => overview.value.breakdown);
const tableTotal = computed(() => overview.value.tableTotal);
const configTotal = computed(() => overview.value.configTotal);
</script>
