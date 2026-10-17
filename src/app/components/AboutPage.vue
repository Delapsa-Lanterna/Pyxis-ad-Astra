<template>
  <div class="settings-page page-content page-slot">
    <header class="settings-header about-header page-header">
      <div class="about-header-content page-identity">
        <h1 class="page-title">关于</h1>
        <p class="about-header-description settings-header-description page-description">
          星界罗盘 [Circinus ad Astra] 的版本、作者和更新记录。
        </p>
      </div>
    </header>

    <section class="settings-section panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="settings-section-title panel-section-title">应用信息</h3>
      <div class="about-info-list schema-form ui-layout-grid">
        <div class="settings-row ui-field-row">
          <span class="settings-row-label ui-field-label">名称</span>
          <strong class="about-info-list-value ui-field-control ui-emphasis ui-text-normal ui-layout-shrink ui-text-wrap"
            >星界罗盘 [Circinus ad Astra]</strong
          >
        </div>
        <div class="settings-row ui-field-row">
          <span class="settings-row-label ui-field-label">当前版本</span>
          <strong class="about-info-list-value ui-field-control ui-emphasis ui-text-normal ui-layout-shrink ui-text-wrap">0.1.0</strong>
        </div>
        <div class="settings-row ui-field-row">
          <span class="settings-row-label ui-field-label">作者</span>
          <strong class="about-info-list-value ui-field-control ui-emphasis ui-text-normal ui-layout-shrink ui-text-wrap"
            >cake、AnyIDElse</strong
          >
        </div>
      </div>
    </section>

    <section class="settings-section panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="settings-section-title panel-section-title">更新内容</h3>
      <!-- eslint-disable-next-line vue/no-v-html -- content from bundled static .md file, not user input -->
      <div class="about-content rich-text ui-text-soft ui-text-small" v-html="changelogHtml" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import changelogRaw from '../../../CHANGELOG.md?raw';

const changelogHtml = computed(() =>
  marked
    .parse(changelogRaw, { async: false })
    .replace(/<([a-z][a-z0-9]*)(?=[\s>])/g, '<$1 class="about-node about-$1 rich-text-node rich-text-$1"'),
);
</script>
